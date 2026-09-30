'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const { DATA_DIR } = require('./db');

const APP_DIR = path.join(__dirname, '..');
const LOG_FILE = path.join(DATA_DIR, 'update.log');
const STATUS_FILE = path.join(DATA_DIR, 'update-status.json');
const BRANCH = process.env.DEPLOY_BRANCH || 'main';
const MAX_LOG_BYTES = 20000;

let inProgress = false;

/* ------------------------------- git info ----------------------------- */

function isGitRepo() {
  return fs.existsSync(path.join(APP_DIR, '.git'));
}

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

/* -------------------------- status & logging -------------------------- */

function tailLog(maxBytes = MAX_LOG_BYTES) {
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

function getStatus() {
  const data = readStatusFile();
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

function runStep(command, args) {
  return new Promise((resolve, reject) => {
    appendLog(`$ ${command} ${args.join(' ')}`);
    const child = spawn(command, args, {
      cwd: APP_DIR,
      env: process.env,
    });
    child.stdout.on('data', (chunk) => {
      try {
        fs.appendFileSync(LOG_FILE, chunk);
      } catch {
        /* ignore */
      }
    });
    child.stderr.on('data', (chunk) => {
      try {
        fs.appendFileSync(LOG_FILE, chunk);
      } catch {
        /* ignore */
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} 退出码 ${code}`));
    });
  });
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

function selfRestart() {
  const node = process.execPath;
  const entry = path.join(APP_DIR, 'server.js');
  const command = `sleep 2; exec "${node}" "${entry}" >> "${LOG_FILE}" 2>&1`;
  const child = spawn('/bin/sh', ['-c', command], {
    cwd: APP_DIR,
    env: process.env,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  appendLog('未检测到进程管理器，已启动新的后台进程，当前进程即将退出');
  setTimeout(() => process.exit(0), 1200);
}

async function restartService() {
  if (underPm2()) {
    appendLog(`检测到 pm2（pm_id=${process.env.pm_id}），使用 pm2 重启`);
    await runStep('pm2', ['restart', process.env.pm_id]);
    return 'pm2';
  }
  const unit = systemdUnit();
  if (unit) {
    appendLog(`检测到 systemd 单元 ${unit}，使用 systemctl 重启`);
    await runStep('systemctl', ['restart', unit]);
    return 'systemd';
  }
  selfRestart();
  return 'self';
}

/* ------------------------------- update ------------------------------- */

async function runUpdate(fromVersion) {
  try {
    await runStep('git', ['fetch', '--prune', 'origin', BRANCH]);
    await runStep('git', ['reset', '--hard', `origin/${BRANCH}`]);
    const toVersion = getVersion();

    writeStatus({ step: 'installing', message: '正在安装依赖…', toVersion });
    await runStep('npm', ['ci', '--omit=dev']);

    appendLog(`代码与依赖已就绪：${fromVersion || '未知'} → ${toVersion || '未知'}`);

    writeStatus({
      status: 'done',
      step: 'restarting',
      message: '正在重启服务…',
      finishedAt: new Date().toISOString(),
      fromVersion,
      toVersion,
    });

    try {
      const mode = await restartService();
      writeStatus({ restartMode: mode, step: 'done', message: '更新完成' });
      appendLog(`更新完成，重启方式：${mode}`);
    } catch (err) {
      writeStatus({
        status: 'failed',
        step: 'failed',
        message: `重启失败：${err.message}`,
        error: err.message,
      });
      appendLog(`重启失败：${err.message}`);
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
  try {
    fs.writeFileSync(LOG_FILE, '');
  } catch {
    /* ignore */
  }
  writeStatus({
    status: 'running',
    step: 'pulling',
    message: '正在拉取最新代码…',
    error: null,
    fromVersion,
    toVersion: null,
    restartMode: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  });
  appendLog(`开始更新，当前版本 ${fromVersion || '未知'}，分支 ${BRANCH}`);

  runUpdate(fromVersion);
}

module.exports = {
  isGitRepo,
  getVersion,
  getBranch,
  getStatus,
  startUpdate,
};
