'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const { DATA_DIR } = require('./db');
const settings = require('./settings');

const APP_DIR = path.join(__dirname, '..');
const LOG_FILE = path.join(DATA_DIR, 'update.log');
const STATUS_FILE = path.join(DATA_DIR, 'update-status.json');
const MAX_LOG_BYTES = 200 * 1024;
const LOG_TAIL_BYTES = 20000;
const GIT_TIMEOUT_MS = 60 * 1000;
const NPM_TIMEOUT_MS = 5 * 60 * 1000;

const DEFAULT_BRANCH = process.env.DEPLOY_BRANCH || 'main';
const BRANCH_KEY = 'deploy_branch';
const REMOTE_URL_KEY = 'deploy_remote_url';

let inProgress = false;
let closeHttpServer = () => {};

/* 由 server.js 注入：execve 接替前先把监听端口交还，避免新进程 EADDRINUSE */
function setHttpCloser(fn) {
  closeHttpServer = typeof fn === 'function' ? fn : () => {};
}

/* ------------------------------- git info ----------------------------- */

function isGitRepo() {
  return fs.existsSync(path.join(APP_DIR, '.git'));
}

/* 同步 git 探测只用于进程启动后的只读展示，绝不放在更新关键路径上 */
function git(args) {
  return execFileSync('git', args, {
    cwd: APP_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function getVersion() {
  if (!isGitRepo()) return '';
  try {
    return git(['rev-parse', '--short', 'HEAD']);
  } catch {
    return '';
  }
}

function getBranch() {
  if (!isGitRepo()) return '';
  try {
    return git(['rev-parse', '--abbrev-ref', 'HEAD']);
  } catch {
    return '';
  }
}

function getDeployedDir() {
  return APP_DIR;
}

/* --------------------------- remote config ---------------------------- */

function getDeployBranch() {
  const value = settings.get(BRANCH_KEY, DEFAULT_BRANCH);
  return value || DEFAULT_BRANCH;
}

function remoteUrlFromGit() {
  if (!isGitRepo()) return '';
  try {
    return git(['remote', 'get-url', 'origin']);
  } catch {
    return '';
  }
}

function getRemoteConfig() {
  return {
    url: remoteUrlFromGit() || settings.get(REMOTE_URL_KEY, ''),
    branch: getDeployBranch(),
  };
}

function setRemote({ url, branch }) {
  if (!isGitRepo()) {
    const err = new Error('部署目录不是 Git 仓库，请先执行 git init');
    err.code = 'no_git';
    throw err;
  }
  const cleanUrl = String(url || '').trim();
  const cleanBranch = String(branch || '').trim() || DEFAULT_BRANCH;

  if (cleanUrl) {
    let hasRemote = true;
    try {
      git(['remote', 'get-url', 'origin']);
    } catch {
      hasRemote = false;
    }
    if (hasRemote) {
      git(['remote', 'set-url', 'origin', cleanUrl]);
    } else {
      git(['remote', 'add', 'origin', cleanUrl]);
    }
    settings.set(REMOTE_URL_KEY, cleanUrl);
  }
  settings.set(BRANCH_KEY, cleanBranch);
  return getRemoteConfig();
}

function execGit(args, timeoutMs = GIT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd: APP_DIR, env: process.env });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('连接超时，请检查服务器能否访问该仓库地址'));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `git ${args.join(' ')} 退出码 ${code}`));
    });
  });
}

async function testRemote() {
  if (!isGitRepo()) {
    const err = new Error('部署目录不是 Git 仓库，请先执行 git init');
    err.code = 'no_git';
    throw err;
  }
  const url = remoteUrlFromGit();
  if (!url) {
    const err = new Error('尚未配置仓库地址');
    err.code = 'no_remote';
    throw err;
  }
  const branch = getDeployBranch();
  const out = await execGit(['ls-remote', '--heads', 'origin', branch]);
  const match = out.match(/^([0-9a-f]{7,40})\s/m);
  return {
    url,
    branch,
    commit: match ? match[0].slice(0, 7) : null,
    message: '连接成功',
  };
}

/* -------------------------- status & logging -------------------------- */

function tailLog(maxBytes = LOG_TAIL_BYTES) {
  try {
    const stat = fs.statSync(LOG_FILE);
    const start = Math.max(0, stat.size - maxBytes);
    const length = stat.size - start;
    const buf = Buffer.alloc(length);
    const fd = fs.openSync(LOG_FILE, 'r');
    fs.readSync(fd, buf, 0, length, start);
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch {
    return '';
  }
}

/* 每次更新前清空，超长时轮转为 .1，超过上限直接删除 */
function rotateLog() {
  try {
    const stat = fs.statSync(LOG_FILE);
    if (stat.size <= MAX_LOG_BYTES) return;
    const old = `${LOG_FILE}.1`;
    try {
      fs.rmSync(old, { force: true });
    } catch {
      /* ignore */
    }
    fs.renameSync(LOG_FILE, old);
  } catch {
    /* ignore */
  }
}

function appendLog(line) {
  try {
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${line}\n`);
  } catch {
    /* ignore */
  }
}

function readStatusFile() {
  try {
    return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeStatus(patch) {
  const next = { ...readStatusFile(), ...patch };
  try {
    fs.writeFileSync(STATUS_FILE, JSON.stringify(next, null, 2));
  } catch {
    /* ignore */
  }
  return next;
}

/**
 * 进程重启后 inProgress 归零，状态文件可能停在两种非终态：
 *
 * - step 为 handing_over：execve 换掉进程前主动写入，新进程读到即认定
 *   上次更新已交接完成，补一个 done 收尾。旧进程在 execve 前被硬杀
 *   （SIGKILL、OOM、cgroup 回收）也会留下这个标记，此时补 done 略有
 *   美化，但此时代码与依赖都已就绪，重启由外部管理器完成，结果一致。
 * - 其余 running 状态：重启环节被真正打断，保留 interrupted 提示重试。
 */
function reconcileStatus(data) {
  if (data.status !== 'running' || inProgress) return data;
  if (data.step === 'handing_over') {
    return {
      ...data,
      status: 'done',
      step: 'done',
      message: '更新完成，服务已重启',
      finishedAt: data.finishedAt || new Date().toISOString(),
      restartMode: data.restartMode || 'exec',
    };
  }
  return {
    ...data,
    status: 'interrupted',
    step: 'interrupted',
    message: '上次更新在服务重启过程中中断，请确认代码版本后重试',
  };
}

function getStatus() {
  const data = reconcileStatus(readStatusFile());
  return {
    status: data.status || 'idle',
    step: data.step || 'idle',
    message: data.message || '',
    error: data.error || null,
    fromVersion: data.fromVersion || null,
    toVersion: data.toVersion || null,
    startedAt: data.startedAt || null,
    finishedAt: data.finishedAt || null,
    restartMode: data.restartMode || null,
    inProgress,
    logTail: tailLog(),
  };
}

/* ------------------------------- steps -------------------------------- */

function spawnStep(command, args, label, timeoutMs) {
  return new Promise((resolve, reject) => {
    appendLog(`$ ${label}`);
    const child = spawn(command, args, {
      cwd: APP_DIR,
      env: process.env,
    });
    let settled = false;
    const timer = timeoutMs
      ? setTimeout(() => {
          child.kill('SIGKILL');
          settle(new Error(`${label} 超时（${Math.round(timeoutMs / 1000)} 秒）`));
        }, timeoutMs)
      : null;

    function settle(err) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    }

    const capture = (chunk) => {
      try {
        fs.appendFileSync(LOG_FILE, chunk);
      } catch {
        /* ignore */
      }
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.on('error', (err) => settle(err));
    child.on('close', (code) => {
      if (code === 0) settle();
      else settle(new Error(`${label} 退出码 ${code}`));
    });
  });
}

function runStep(command, args, timeoutMs) {
  return spawnStep(command, args, `${command} ${args.join(' ')}`, timeoutMs);
}

function runShell(command) {
  return spawnStep('/bin/sh', ['-c', command], command);
}

/* ------------------------- working tree guard ------------------------- */

/**
 * reset --hard 会无条件丢弃 tracked 修改，并删除所有未跟踪文件与目录。
 * 更新前先体检，发现本地改动就中止，让使用者自己决定怎么处理。
 */
async function inspectWorkingTree() {
  if (!isGitRepo()) {
    const err = new Error('部署目录不是 Git 仓库，无法自动更新');
    err.code = 'no_git';
    throw err;
  }

  const [statusOut, head, target] = await Promise.all([
    execGit(['status', '--porcelain']),
    execGit(['rev-parse', 'HEAD']),
    execGit(['rev-parse', '--verify', '--quiet', `origin/${getDeployBranch()}`]).catch(
      () => '',
    ),
  ]);

  const dirty = statusOut
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const out = {
    dirty: false,
    files: [],
    head: head.slice(0, 7),
    target: target ? target.slice(0, 7) : null,
    upToDate: false,
  };

  if (dirty.length) {
    out.dirty = true;
    out.files = dirty.slice(0, 20);
  }

  if (out.target) {
    out.upToDate = head.trim() === target.trim();
  }

  return out;
}

function dirtyMessage(inspect) {
  const preview = inspect.files.slice(0, 5).join('、');
  const more = inspect.files.length > 5 ? ` 等 ${inspect.files.length} 项` : '';
  return `部署目录存在本地改动：${preview}${more}。请先提交或备份后重试`;
}

/* ------------------------------ restart ------------------------------- */

function underPm2() {
  return process.env.pm_id !== undefined && process.env.pm_id !== '';
}
function systemdUnit() {
  if (!process.env.INVOCATION_ID) return null;
  try {
    const cgroup = fs.readFileSync('/proc/self/cgroup', 'utf8');
    const match = cgroup.match(/([^/\n]+\.service)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * 兜底重启：execve 直接把当前进程替换成新的服务进程，PID 保持不变。
 *
 * 之前用 spawn(detached) + exit(0) 的做法会断开与进程管理器的托管契约：
 * 管理器看到退出码 0 便认为服务正常结束并回收整个 cgroup，孙进程被连带
 * 杀掉，同时状态文件还停留在 running 骗前端说「更新完成」。execve 不存在
 * 这个窗口，因为 PID 从未变化。
 */
function selfRestart() {
  appendLog('未检测到进程管理器，使用 execve 接替当前进程重启（PID 不变）');
  /* 交接标记：execve 后本进程不复存在，必须先把意图落盘，
     新进程读到它才会把这次更新收尾为 done */
  writeStatus({
    step: 'handing_over',
    message: '正在重启服务（execve 接替，PID 不变）…',
  });
  // 给同进程内的 HTTP 响应一个刷盘窗口，避免 202 响应还在内核缓冲区里就换掉进程
  setTimeout(() => {
    closeHttpServer(() => {
      try {
        process.execve(process.execPath, [process.execPath, path.join(APP_DIR, 'server.js')], {
          ...process.env,
        });
      } catch (err) {
        appendLog(`execve 重启失败：${err.message}，请手动重启服务`);
        writeStatus({
          status: 'failed',
          step: 'failed',
          message: `代码与依赖已更新，但重启失败：${err.message}，请手动重启服务`,
          error: err.message,
          finishedAt: new Date().toISOString(),
        });
        // 端口已释放且 execve 失败，无法原地恢复，记为致命错误退出，
        // 交给外部进程管理器拉起全新进程
        appendLog('端口已释放且 execve 失败，进程退出，等待进程管理器拉起');
        process.exit(1);
      }
    });
  }, 800);
  return 'exec';
}

async function restartService() {
  const custom = (process.env.RESTART_COMMAND || '').trim();
  if (custom) {
    appendLog(`使用 RESTART_COMMAND 重启：${custom}`);
    await runShell(custom);
    return 'custom';
  }
  if (underPm2()) {
    appendLog(`检测到 pm2（pm_id=${process.env.pm_id}），使用 pm2 重启`);
    await runStep('pm2', ['restart', process.env.pm_id], NPM_TIMEOUT_MS);
    return 'pm2';
  }
  const unit = systemdUnit();
  if (unit) {
    appendLog(`检测到 systemd 单元 ${unit}，使用 systemctl 重启`);
    try {
      await runStep('systemctl', ['restart', unit], NPM_TIMEOUT_MS);
      return 'systemd';
    } catch (err) {
      appendLog(`systemctl 重启 ${unit} 失败：${err.message}，尝试 sudo -n`);
      await runStep('sudo', ['-n', 'systemctl', 'restart', unit], NPM_TIMEOUT_MS);
      return 'systemd';
    }
  }
  return selfRestart();
}

/* ------------------------------- update ------------------------------- */

async function runUpdate(fromVersion) {
  try {
    const branch = getDeployBranch();

    writeStatus({ step: 'inspecting', message: '正在检查部署目录…' });
    const inspect = await inspectWorkingTree();
    appendLog(
      `部署目录检查：HEAD ${inspect.head}，目标 ${inspect.target || '未知'}${
        inspect.upToDate ? '（已是最新）' : ''
      }，本地改动 ${inspect.dirty ? `${inspect.files.length} 项` : '无'}`,
    );
    if (inspect.dirty) {
      const err = new Error(dirtyMessage(inspect));
      err.code = 'dirty_tree';
      throw err;
    }

    writeStatus({ step: 'pulling', message: '正在拉取最新代码…' });
    await runStep('git', ['fetch', '--prune', 'origin', branch], GIT_TIMEOUT_MS);
    await runStep('git', ['reset', '--hard', `origin/${branch}`], GIT_TIMEOUT_MS);
    const toVersion = getVersion();

    if (toVersion === fromVersion) {
      appendLog(`代码已是最新版本 ${toVersion || '未知'}，跳过依赖安装`);
      writeStatus({
        status: 'done',
        step: 'done',
        message: '代码已是最新版本，无需更新',
        finishedAt: new Date().toISOString(),
        fromVersion,
        toVersion,
        restartMode: 'skipped',
      });
      appendLog('代码已是最新版本，未执行重启');
      return;
    }

    writeStatus({ step: 'installing', message: '正在安装依赖…', toVersion });
    await runStep('npm', ['ci', '--omit=dev'], NPM_TIMEOUT_MS);

    appendLog(`代码与依赖已就绪：${fromVersion || '未知'} → ${toVersion || '未知'}`);

    writeStatus({
      step: 'restarting',
      message: '正在重启服务…',
      fromVersion,
      toVersion,
    });

    try {
      const mode = await restartService();
      appendLog(`更新完成，重启方式：${mode}`);
      /* selfRestart 走 execve，本进程即将不复存在：状态由 selfRestart 写入
         handing_over，新进程启动时 reconcileStatus 收尾为 done。
         其余模式由外部管理器重启进程，这里直接写终态作为交接记录。 */
      if (mode !== 'exec') {
        writeStatus({
          status: 'done',
          step: 'done',
          message: '更新完成',
          finishedAt: new Date().toISOString(),
          restartMode: mode,
        });
      }
    } catch (err) {
      writeStatus({
        status: 'failed',
        step: 'failed',
        message: `代码与依赖已更新，但重启失败：${err.message}，请手动重启服务`,
        error: err.message,
        finishedAt: new Date().toISOString(),
      });
      appendLog(
        `重启失败：${err.message}。代码与依赖已更新，请手动重启服务，或设置 RESTART_COMMAND 指定重启命令`,
      );
    }
  } catch (err) {
    writeStatus({
      status: 'failed',
      step: 'failed',
      message: err.message || '更新失败',
      error: err.message || '更新失败',
      finishedAt: new Date().toISOString(),
    });
    appendLog(`更新失败：${err.message}`);
  } finally {
    inProgress = false;
  }
}

function startUpdate() {
  if (inProgress) {
    const err = new Error('已有更新任务正在进行，请稍候');
    err.code = 'busy';
    throw err;
  }
  if (!isGitRepo()) {
    const err = new Error('部署目录不是 Git 仓库，无法自动更新');
    err.code = 'no_git';
    throw err;
  }

  inProgress = true;
  const fromVersion = getVersion();
  rotateLog();
  try {
    fs.writeFileSync(LOG_FILE, '');
  } catch {
    /* ignore */
  }
  writeStatus({
    status: 'running',
    step: 'inspecting',
    message: '正在检查部署目录…',
    error: null,
    fromVersion,
    toVersion: null,
    restartMode: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  });
  appendLog(`开始更新，当前版本 ${fromVersion || '未知'}，分支 ${getDeployBranch()}`);

  runUpdate(fromVersion);
}

module.exports = {
  isGitRepo,
  getVersion,
  getBranch,
  getDeployedDir,
  getRemoteConfig,
  setRemote,
  testRemote,
  getStatus,
  startUpdate,
  setHttpCloser,
};
