'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const { DATA_DIR } = require('./db');
const settings = require('./settings');

const APP_DIR = path.join(__dirname, '..');
const LOG_FILE = path.join(DATA_DIR, 'update.log');
const STATUS_FILE = path.join(DATA_DIR, 'update-status.json');
const LOCK_FILE = path.join(DATA_DIR, 'update.lock');
const MAX_LOG_BYTES = 200 * 1024;
const LOG_TAIL_BYTES = 20000;
const GIT_TIMEOUT_MS = 60 * 1000;
const NPM_TIMEOUT_MS = 5 * 60 * 1000;
const STALE_LOCK_MS = 15 * 60 * 1000;

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

/* --------------------------- cross-process lock ----------------------- */

/**
 * inProgress 只在单进程内有效。pm2 cluster / 多实例部署下必须靠文件锁
 * 保证同一时刻只有一个更新任务。wx 标志保证「创建」是原子操作；获取失败
 * 时读取锁内容，超过 STALE_LOCK_MS 的视为进程被硬杀留下的陈旧锁并接管。
 */
function tryAcquireLock() {
  const payload = JSON.stringify({ pid: process.pid, startedAt: Date.now() });
  try {
    fs.writeFileSync(LOCK_FILE, payload, { flag: 'wx' });
    return true;
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }

  let stale = true;
  try {
    const info = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
    stale = !info.startedAt || Date.now() - info.startedAt > STALE_LOCK_MS;
  } catch {
    stale = true;
  }
  if (!stale) return false;

  try {
    fs.rmSync(LOCK_FILE, { force: true });
    fs.writeFileSync(LOCK_FILE, payload, { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}

function releaseLock() {
  try {
    fs.rmSync(LOCK_FILE, { force: true });
  } catch {
    /* ignore */
  }
}

/**
 * 进程重启后 inProgress 归零，状态文件可能停在非终态，按以下规则收尾：
 *
 * - step 为 handing_over：重启前主动落盘的交接标记，execve、pm2、systemd
 *   触发重启前都会写入，新进程读到即认定上次更新已交接完成，补一个 done。
 *   旧进程在交接前被硬杀（SIGKILL、OOM、cgroup 回收）也会留下这个标记，
 *   此时补 done 略有美化，但代码与依赖都已就绪，重启由外部管理器完成，
 *   结果一致。
 * - 其余 running 状态：重启环节被真正打断（含 reset 后 npm 安装期间被杀），
 *   保留 interrupted 提示重试。
 *
 * 这里刻意不用「toVersion 等于当前 HEAD」作判据：reset --hard 之后、依赖
 * 尚未装完时磁盘 HEAD 就已经是新版本，若有另一个实例（pm2 cluster）此刻
 * 轮询状态，会被误判为 done。
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
 * 更新流程执行的是 reset --hard，它只覆盖被跟踪（tracked）文件，不会删除
 * 未跟踪文件。因此这里只拦「被跟踪文件的改动」，放行 .htaccess、启动脚本
 * 这类部署目录里的本地未跟踪文件。
 *
 * 唯一例外：若未跟踪文件与即将拉取的文件同名，reset --hard 会静默覆盖它，
 * 这种情况单独校验，见 findUntrackedCollisions()。
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

  const lines = statusOut
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean);
  // 以 ?? 开头的为未跟踪文件，reset --hard 不碰它们
  const tracked = lines.filter((line) => !line.startsWith('??'));

  const out = {
    dirty: tracked.length > 0,
    files: tracked.slice(0, 20),
    head: head.slice(0, 7),
    target: target ? target.slice(0, 7) : null,
    upToDate: false,
  };

  if (out.target) {
    out.upToDate = head.trim() === target.trim();
  }

  return out;
}

/**
 * 找出「本地存在、HEAD 未跟踪、而远程即将跟踪」的同名路径。
 * reset --hard 会直接覆盖它们且不报错，属于静默数据丢失，必须拦下。
 *
 * 用 HEAD 清单过滤 + 本地文件存在性判断，天然覆盖被 .gitignore 忽略的
 * 文件（.env、data/ 等），也无需枚举 node_modules 这类忽略目录。
 */
async function findUntrackedCollisions(branch) {
  const [headList, incomingList] = await Promise.all([
    execGit(['ls-tree', '-r', '--name-only', 'HEAD']),
    execGit(['ls-tree', '-r', '--name-only', `origin/${branch}`]),
  ]);

  const tracked = new Set(headList.split('\n').filter(Boolean));
  return incomingList
    .split('\n')
    .filter(Boolean)
    .filter((file) => !tracked.has(file) && fs.existsSync(path.join(APP_DIR, file)));
}

function dirtyMessage(inspect) {
  const preview = inspect.files.slice(0, 5).join('、');
  const more = inspect.files.length > 5 ? ` 等 ${inspect.files.length} 项` : '';
  return `部署目录存在本地改动：${preview}${more}。请先提交或备份后重试`;
}

function collisionMessage(files) {
  const preview = files.slice(0, 5).join('、');
  const more = files.length > 5 ? ` 等 ${files.length} 项` : '';
  return `以下本地文件会被远程同名文件覆盖：${preview}${more}。请先重命名或备份后重试`;
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
    // 优先按应用名重启，让 cluster 模式下所有实例一起换新代码；只重启单个
    // pm_id 会让其余 worker 继续跑旧代码。环境未提供 name 时退回 pm_id。
    const appName = (process.env.name || '').trim();
    const target = appName || process.env.pm_id;
    try {
      appendLog(
        appName
          ? `检测到 pm2（${appName}），使用 pm2 restart ${appName} 重启全部实例`
          : `检测到 pm2（pm_id=${process.env.pm_id}），使用 pm2 重启`,
      );
      await runStep('pm2', ['restart', target], NPM_TIMEOUT_MS);
      return 'pm2';
    } catch (err) {
      appendLog(`pm2 重启失败：${err.message}，回退为 execve 接替`);
    }
  }
  const unit = systemdUnit();
  if (unit) {
    appendLog(`检测到 systemd 单元 ${unit}，使用 systemctl 重启`);
    try {
      await runStep('systemctl', ['restart', unit], NPM_TIMEOUT_MS);
      return 'systemd';
    } catch (err) {
      appendLog(`systemctl 重启 ${unit} 失败：${err.message}，尝试 sudo -n`);
      try {
        await runStep('sudo', ['-n', 'systemctl', 'restart', unit], NPM_TIMEOUT_MS);
        return 'systemd';
      } catch (sudoErr) {
        appendLog(
          `sudo -n 重启同样失败：${sudoErr.message}。` +
            'execve 接替保持 PID 不变，systemd 无需授权即可完成重启',
        );
      }
    }
  }
  return selfRestart();
}

/* ------------------------------- update ------------------------------- */

/**
 * npm ci 会先清空 node_modules，万一安装失败，磁盘代码已是新版、依赖却是
 * 坏的，下次重启可能起不来。这里回滚到更新前的 commit，并尽量按旧 lock
 * 恢复依赖，让运行中的旧代码与磁盘保持一致。
 */
async function rollback(fromVersion) {
  if (!fromVersion) {
    appendLog('缺少更新前版本号，跳过代码回滚，请手动处理');
    return false;
  }
  try {
    await runStep('git', ['reset', '--hard', fromVersion], GIT_TIMEOUT_MS);
    appendLog(`代码已回滚到 ${fromVersion}`);
  } catch (err) {
    appendLog(`代码回滚失败：${err.message}，请手动恢复`);
    return false;
  }
  try {
    await runStep('npm', ['ci', '--omit=dev'], NPM_TIMEOUT_MS);
    appendLog('旧版本依赖已恢复');
  } catch (err) {
    appendLog(`旧版本依赖恢复失败：${err.message}，请手动执行 npm ci`);
  }
  return true;
}

async function runUpdate(fromVersion) {
  try {
    const branch = getDeployBranch();

    writeStatus({ step: 'inspecting', message: '正在检查部署目录…' });
    const inspect = await inspectWorkingTree();
    appendLog(
      `部署目录检查：HEAD ${inspect.head}，目标 ${inspect.target || '未知'}${
        inspect.upToDate ? '（已是最新）' : ''
      }，被跟踪文件改动 ${inspect.dirty ? `${inspect.files.length} 项` : '无'}`,
    );
    if (inspect.dirty) {
      const err = new Error(dirtyMessage(inspect));
      err.code = 'dirty_tree';
      throw err;
    }

    writeStatus({ step: 'pulling', message: '正在拉取最新代码…' });
    await runStep('git', ['fetch', '--prune', 'origin', branch], GIT_TIMEOUT_MS);

    // fetch 之后才能拿到最新的远程文件清单，据此校验未跟踪文件的同名冲突
    const collisions = await findUntrackedCollisions(branch);
    if (collisions.length) {
      appendLog(`发现未跟踪文件同名冲突：${collisions.join('、')}`);
      const err = new Error(collisionMessage(collisions));
      err.code = 'untracked_collision';
      throw err;
    }

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
    try {
      await runStep('npm', ['ci', '--omit=dev'], NPM_TIMEOUT_MS);
    } catch (err) {
      appendLog(`依赖安装失败：${err.message}`);
      writeStatus({ step: 'rolling_back', message: '依赖安装失败，正在回滚…' });
      const rolledBack = await rollback(fromVersion);
      const failErr = new Error(
        rolledBack
          ? `依赖安装失败，已回滚到原版本：${err.message}`
          : `依赖安装失败，且回滚未完全成功，请手动处理：${err.message}`,
      );
      failErr.code = err.code || 'npm_failed';
      throw failErr;
    }

    appendLog(`代码与依赖已就绪：${fromVersion || '未知'} → ${toVersion || '未知'}`);

    /* 触发任何重启方式前先落交接标记：pm2/systemctl 会先杀掉本进程，
       之后的 done 写入没有机会执行。新进程读到 handing_over 即收尾为 done。 */
    writeStatus({
      step: 'handing_over',
      message: '正在重启服务…',
      fromVersion,
      toVersion,
    });

    /* 更新工作已完成，锁的使命结束。必须在触发重启前释放：execve 会保留
       PID，若把锁带到新进程，会被当成「正在更新」的活锁再阻塞 15 分钟。 */
    releaseLock();

    try {
      const mode = await restartService();
      appendLog(`更新完成，重启方式：${mode}`);
      /* 进程存活时（自定义 RESTART_COMMAND 未杀当前进程，或 pm2 抢跑前
         代码恰好执行到）直接写终态作为确认；进程已退出则由新进程 reconcile。 */
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
    releaseLock();
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
  // 单进程靠 inProgress，跨进程（pm2 cluster / 多实例）靠文件锁
  if (!tryAcquireLock()) {
    const err = new Error('已有更新任务正在进行，请稍候');
    err.code = 'busy';
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
  // 仅供单元测试使用的内部实现
  _internal: { reconcileStatus, findUntrackedCollisions, tryAcquireLock, releaseLock },
};
