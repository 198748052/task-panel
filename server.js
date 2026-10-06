'use strict';

require('./src/env');

process.removeAllListeners('warning');

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');

const store = require('./src/store');
const { UPLOAD_DIR } = require('./src/db');
const objectStore = require('./src/storage');
const auth = require('./src/auth');
const updater = require('./src/updater');
const exporter = require('./src/export');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 100);
const MAX_R2_UPLOAD_MB = Number(process.env.MAX_R2_UPLOAD_MB || 5120);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

/* ------------------------------ uploads ------------------------------ */

const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').slice(0, 16);
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});
const uploadLocal = multer({
  storage: diskStorage,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
});
const uploadR2 = multer({
  storage: diskStorage,
  limits: { fileSize: MAX_R2_UPLOAD_MB * 1024 * 1024 },
});

function selectUploader(req, res, next) {
  const target = req.query.storage === 'r2' ? 'r2' : 'local';
  if (target === 'r2' && !objectStore.isConfigured()) {
    return res
      .status(400)
      .json({ error: 'r2_unavailable', message: '未配置 Cloudflare R2，无法上传到云端' });
  }
  req.uploadTarget = target;
  const handler = target === 'r2' ? uploadR2 : uploadLocal;
  return handler.array('files', 20)(req, res, next);
}

/* -------------------------------- auth ------------------------------- */

const loginAttempts = new Map();

function recordFailure(ip) {
  const entry = loginAttempts.get(ip) || { count: 0, until: 0 };
  entry.count += 1;
  if (entry.count >= 5) {
    entry.until = Date.now() + 1000 * 60 * 5;
    entry.count = 0;
  }
  loginAttempts.set(ip, entry);
}

function isBlocked(ip) {
  const entry = loginAttempts.get(ip);
  return !!entry && entry.until > Date.now();
}

function setSessionCookie(res, token) {
  res.cookie(auth.COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: auth.SESSION_TTL_MS,
  });
}

/*
 * 移动端无法依赖 httpOnly Cookie，改为携带同一枚签名会话令牌：
 *   Authorization: Bearer <token>
 * 与 Cookie 共用 createToken/verify，密码变更会通过会话版本使旧令牌失效。
 */
function isAuthed(req) {
  if (!auth.isEnabled()) return true;
  return !!auth.verify(auth.extractToken(req));
}

function requireAuth(req, res, next) {
  if (isAuthed(req)) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

app.get('/api/session', (req, res) => {
  res.json({
    authEnabled: auth.isEnabled(),
    authed: isAuthed(req),
    maxUploadMb: MAX_UPLOAD_MB,
    maxR2UploadMb: MAX_R2_UPLOAD_MB,
    retentionDays: store.RETENTION_DAYS,
    r2Enabled: objectStore.isConfigured(),
    deployedDir: updater.getDeployedDir(),
  });
});

app.post('/api/login', (req, res) => {
  const ip = req.ip || 'unknown';
  if (isBlocked(ip)) {
    return res
      .status(429)
      .json({ error: 'too_many_attempts', message: '尝试次数过多，请 5 分钟后再试' });
  }
  const { username, password } = req.body || {};
  if (!auth.checkCredentials(username, password)) {
    recordFailure(ip);
    return res.status(401).json({ error: 'bad_credentials', message: '用户名或密码错误' });
  }
  const token = auth.createToken();
  setSessionCookie(res, token);
  res.json({ ok: true, token, expiresInMs: auth.SESSION_TTL_MS });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie(auth.COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

/* 移动端一次性拉取全量快照：任务树 + 回收站 + 会话相关配置，减少往返请求 */
app.get('/api/sync', requireAuth, (req, res) => {
  res.json({
    serverTime: new Date().toISOString(),
    tasks: store.listTasks(),
    trash: store.listTrash(),
    retentionDays: store.RETENTION_DAYS,
    maxUploadMb: MAX_UPLOAD_MB,
    maxR2UploadMb: MAX_R2_UPLOAD_MB,
    r2Enabled: objectStore.isConfigured(),
  });
});

app.get('/api/account', requireAuth, (req, res) => {
  const account = auth.getAccount();
  res.json({ username: account ? account.username : '' });
});

app.put('/api/account', requireAuth, (req, res) => {
  const { username, currentPassword, newPassword } = req.body || {};
  try {
    const account = auth.changeAccount({ username, currentPassword, newPassword });
    // 改密会使会话版本变化，旧令牌立即失效，因此这里签发并下发给移动端新令牌
    const token = auth.createToken();
    setSessionCookie(res, token);
    res.json({ ok: true, username: account.username, token, expiresInMs: auth.SESSION_TTL_MS });
  } catch (err) {
    res.status(400).json({ error: err.code || 'update_failed', message: err.message });
  }
});

/* ----------------------------- settings ------------------------------ */

app.get('/api/settings', requireAuth, (req, res) => {
  res.json({ r2: objectStore.getPublicConfig() });
});

app.put('/api/settings', requireAuth, (req, res) => {
  res.json({ r2: objectStore.updateConfig(req.body || {}) });
});

app.post('/api/settings/test', requireAuth, async (req, res) => {
  try {
    const result = await objectStore.testConfig(req.body || {});
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: 'r2_test_failed',
      message: err.message || '连接测试失败',
    });
  }
});

/* ------------------------------- system ------------------------------ */

app.get('/api/system', requireAuth, (req, res) => {
  res.json({
    version: updater.getVersion(),
    branch: updater.getBranch(),
    git: updater.isGitRepo(),
    remote: updater.getRemoteConfig(),
    update: updater.getStatus(),
  });
});

app.put('/api/system/remote', requireAuth, (req, res) => {
  try {
    const remote = updater.setRemote(req.body || {});
    res.json({ ok: true, remote });
  } catch (err) {
    res
      .status(400)
      .json({ error: err.code || 'remote_failed', message: err.message });
  }
});

app.post('/api/system/remote/test', requireAuth, async (req, res) => {
  try {
    const result = await updater.testRemote();
    res.json({ ok: true, ...result });
  } catch (err) {
    res
      .status(400)
      .json({ ok: false, error: err.code || 'remote_test_failed', message: err.message });
  }
});

app.post('/api/system/update', requireAuth, (req, res) => {
  try {
    updater.startUpdate();
    res.status(202).json({ ok: true, message: '已开始更新' });
  } catch (err) {
    res
      .status(409)
      .json({ error: err.code || 'update_failed', message: err.message });
  }
});

/* -------------------------------- tasks ------------------------------ */

app.get('/api/tasks', requireAuth, (req, res) => {
  res.json({ tasks: store.listTasks() });
});

app.post('/api/tasks', requireAuth, (req, res) => {
  const { title, description, color } = req.body || {};
  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: 'title_required', message: '任务名称不能为空' });
  }
  res.status(201).json({ task: store.createTask({ title, description, color }) });
});

app.patch('/api/tasks/:id', requireAuth, (req, res) => {
  const task = store.updateTask(req.params.id, req.body || {});
  if (!task) return res.status(404).json({ error: 'not_found' });
  res.json({ task });
});

app.delete('/api/tasks/:id', requireAuth, (req, res) => {
  const result = store.trashTask(req.params.id);
  if (!result) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true, batch: result.batch });
});

app.post('/api/tasks/reorder', requireAuth, (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids_required' });
  store.reorderTasks(ids);
  res.json({ ok: true });
});

/* -------------------------------- nodes ------------------------------ */

app.post('/api/tasks/:id/nodes', requireAuth, (req, res) => {
  const { title, content } = req.body || {};
  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: 'title_required', message: '节点名称不能为空' });
  }
  const node = store.createNode(req.params.id, { title, content });
  if (!node) return res.status(404).json({ error: 'task_not_found' });
  res.status(201).json({ node });
});

app.patch('/api/nodes/:id', requireAuth, (req, res) => {
  const node = store.updateNode(req.params.id, req.body || {});
  if (!node) return res.status(404).json({ error: 'not_found' });
  res.json({ node });
});

app.delete('/api/nodes/:id', requireAuth, (req, res) => {
  const result = store.trashNode(req.params.id);
  if (!result) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true, batch: result.batch });
});

app.post('/api/nodes/reorder', requireAuth, (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids_required' });
  store.reorderNodes(ids);
  res.json({ ok: true });
});

/* ---------------------------- attachments ---------------------------- */

app.post(
  '/api/nodes/:id/attachments',
  requireAuth,
  selectUploader,
  async (req, res, next) => {
    if (!store.getNode(req.params.id)) {
      return res.status(404).json({ error: 'not_found' });
    }
    const target = req.uploadTarget;
    const files = req.files || [];
    try {
      const created = [];
      for (const f of files) {
        let storedName = f.filename;
        if (target === 'r2') {
          storedName = objectStore.makeKey(f.originalname);
          const stagedPath = path.join(UPLOAD_DIR, f.filename);
          try {
            await objectStore.putObject(
              storedName,
              fs.createReadStream(stagedPath),
              f.mimetype,
              f.size,
            );
          } finally {
            fs.promises.unlink(stagedPath).catch(() => {});
          }
        }
        created.push(
          store.addAttachment(req.params.id, {
            storedName,
            originalname: f.originalname,
            mimeType: f.mimetype,
            size: f.size,
            storage: target,
          }),
        );
      }
      res.status(201).json({
        attachments: created.filter(Boolean),
        storage: target,
      });
    } catch (err) {
      next(err);
    }
  },
);

const INLINE_TYPES = [
  /^image\//,
  /^application\/pdf$/,
  /^text\//,
  /^video\//,
  /^audio\//,
  /^application\/json$/,
];

app.get('/api/attachments/:id', requireAuth, (req, res) => {
  const att = store.getAttachment(req.params.id);
  if (!att) return res.status(404).json({ error: 'not_found' });
  if ((att.storage || 'local') === 'r2') {
    const url = objectStore.publicUrl(att.stored_name);
    if (!url) return res.status(500).json({ error: 'r2_not_configured' });
    return res.redirect(302, url);
  }
  const filePath = path.join(UPLOAD_DIR, att.stored_name);
  if (!fs.existsSync(filePath)) {
    return res.status(410).json({ error: 'file_missing' });
  }
  const inline =
    req.query.inline === '1' &&
    INLINE_TYPES.some((re) => re.test(att.mime_type || ''));
  res.setHeader('Content-Type', att.mime_type || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(
      att.original_name,
    )}`,
  );
  fs.createReadStream(filePath).pipe(res);
});

app.patch('/api/attachments/:id', requireAuth, (req, res) => {
  const attachment = store.updateAttachment(req.params.id, req.body || {});
  if (!attachment) return res.status(404).json({ error: 'not_found' });
  res.json({ attachment });
});

app.delete('/api/attachments/:id', requireAuth, (req, res) => {
  const result = store.trashAttachment(req.params.id);
  if (!result) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true, batch: result.batch });
});

/* ------------------------------- trash ------------------------------- */

app.get('/api/trash', requireAuth, (req, res) => {
  res.json({ items: store.listTrash(), retentionDays: store.RETENTION_DAYS });
});

app.post('/api/trash/empty', requireAuth, (req, res) => {
  removeStored(store.emptyTrash());
  res.json({ ok: true });
});

app.post('/api/trash/:batch/restore', requireAuth, (req, res) => {
  if (!store.restoreTrash(req.params.batch)) {
    return res.status(404).json({ error: 'not_found' });
  }
  res.json({ ok: true });
});

app.delete('/api/trash/:batch', requireAuth, (req, res) => {
  const items = store.purgeTrash(req.params.batch);
  if (items === null) return res.status(404).json({ error: 'not_found' });
  removeStored(items);
  res.json({ ok: true });
});

/* ------------------------------- export ------------------------------ */

app.get('/api/export', requireAuth, (req, res, next) => {
  let snapshot;
  try {
    snapshot = store.exportSnapshot();
  } catch (err) {
    return next(err);
  }
  if (snapshot.length === 0) {
    return res.status(400).json({ error: 'empty', message: '没有可导出的内容' });
  }

  const stamp = new Date()
    .toISOString()
    .replace(/\.\d+Z$/, '')
    .replace(/[-:]/g, '')
    .replace('T', '-');
  const filename = `task-board-export-${stamp}.zip`;

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  exporter.buildArchive(res, snapshot).catch((err) => {
    if (res.headersSent) res.destroy(err);
    else next(err);
  });
});

/* ------------------------------ static ------------------------------- */

const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

/* ------------------------------ errors ------------------------------- */

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const limitMb =
      req.uploadTarget === 'r2' ? MAX_R2_UPLOAD_MB : MAX_UPLOAD_MB;
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? `文件超过 ${limitMb} MB 限制`
        : '文件上传失败';
    return res.status(400).json({ error: err.code, message });
  }
  console.error(err);
  res.status(500).json({ error: 'internal_error', message: '服务器内部错误' });
});

function removeStored(items) {
  for (const item of items || []) {
    if (!item || !item.stored_name) continue;
    if ((item.storage || 'local') === 'r2') {
      objectStore
        .deleteObject(item.stored_name)
        .catch((err) => console.error('R2 删除失败:', err.message));
    } else {
      fs.promises
        .unlink(path.join(UPLOAD_DIR, item.stored_name))
        .catch(() => {});
    }
  }
}

function purgeExpiredTrash() {
  try {
    removeStored(store.purgeExpired());
  } catch (err) {
    console.error('回收站清理失败:', err);
  }
}

purgeExpiredTrash();
setInterval(purgeExpiredTrash, 60 * 60 * 1000).unref();

const server = app.listen(PORT, HOST, () => {
  console.log(`任务面板已启动: http://${HOST}:${PORT}`);
  console.log('已启用账号登录，仅支持单个账号（不开放注册）');
});

/*
 * execve 重启时旧进程的 server 尚未 close，新进程立刻 listen 会撞 EADDRINUSE。
 * 先释放端口再让出执行权，保证同一 PID 换新代码时服务始终可用。
 */
server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用，请先停止占用进程或修改 PORT 后重启`);
  } else {
    console.error('服务启动失败:', err);
  }
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('未捕获异常:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('未处理的 Promise 拒绝:', err);
});

/*
 * execve 重启时旧进程的 server 尚未 close，新进程立刻 listen 会撞 EADDRINUSE。
 * 先释放端口再让出执行权，保证同一 PID 换新代码时服务始终可用。
 */
updater.setHttpCloser((done) => {
  server.close(() => done());
  // 长连接会让 close 一直等，给一个上限兜底
  setTimeout(done, 3000).unref();
});

module.exports = app;
