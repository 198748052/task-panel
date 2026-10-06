'use strict';

const crypto = require('node:crypto');
const { db } = require('./db');

const SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const COOKIE_NAME = 'tb_session';
const SCRYPT_KEYLEN = 64;
const MIN_PASSWORD_LENGTH = 6;

const DEFAULT_USERNAME = process.env.APP_USERNAME || 'admin';
const DEFAULT_PASSWORD = process.env.APP_PASSWORD || 'admin123';

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN).toString('hex');
}

function verifyPassword(password, salt, hash) {
  const derived = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

function getAccount() {
  return db.prepare('SELECT * FROM account WHERE id = 1').get() || null;
}

function seedAccount() {
  if (getAccount()) return;
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare(
    `INSERT INTO account (id, username, password_hash, salt, updated_at)
     VALUES (1, ?, ?, ?, ?)`,
  ).run(
    DEFAULT_USERNAME,
    hashPassword(DEFAULT_PASSWORD, salt),
    salt,
    new Date().toISOString(),
  );
  console.log(
    `已创建默认登录账号：${DEFAULT_USERNAME} / ${DEFAULT_PASSWORD}，请登录后在「设置」中修改`,
  );
}

seedAccount();

function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', SECRET)
    .update(data)
    .digest('base64url');
  return `${data}.${sig}`;
}

function sessionVersion() {
  const account = getAccount();
  if (!account) return '';
  return crypto
    .createHash('sha256')
    .update(account.password_hash)
    .digest('base64url')
    .slice(0, 16);
}

function verify(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const idx = token.lastIndexOf('.');
  const data = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = crypto
    .createHmac('sha256', SECRET)
    .update(data)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    if (payload.v !== sessionVersion()) return null;
    return payload;
  } catch {
    return null;
  }
}

function checkCredentials(username, password) {
  const account = getAccount();
  if (!account) return false;
  const userBuf = Buffer.from(String(username ?? ''), 'utf8');
  const nameBuf = Buffer.from(account.username, 'utf8');
  const userOk =
    userBuf.length === nameBuf.length && crypto.timingSafeEqual(userBuf, nameBuf);
  const passOk = verifyPassword(password ?? '', account.salt, account.password_hash);
  return userOk && passOk;
}

function createToken() {
  return sign({ exp: Date.now() + SESSION_TTL_MS, v: sessionVersion() });
}

/*
 * 统一提取会话令牌：优先 Cookie（Web），回退 Authorization: Bearer（移动端）。
 * 接受 Express req 或仅含 headers 的普通对象，便于单元测试。
 */
function extractToken(req) {
  if (!req) return '';
  const cookieToken = req.cookies?.[COOKIE_NAME];
  if (cookieToken) return String(cookieToken);
  const header = req.get
    ? req.get('authorization')
    : req.headers?.authorization;
  const match = /^Bearer\s+(.+)$/i.exec(String(header || '').trim());
  return match ? match[1].trim() : '';
}

function changeAccount({ username, currentPassword, newPassword }) {
  const account = getAccount();
  if (!account) {
    const err = new Error('账号不存在');
    err.code = 'account_missing';
    throw err;
  }
  if (!verifyPassword(currentPassword ?? '', account.salt, account.password_hash)) {
    const err = new Error('当前密码错误');
    err.code = 'bad_password';
    throw err;
  }

  const nextUsername = String(username ?? account.username).trim();
  if (!nextUsername) {
    const err = new Error('用户名不能为空');
    err.code = 'username_required';
    throw err;
  }
  if (nextUsername.length > 64) {
    const err = new Error('用户名过长（最多 64 个字符）');
    err.code = 'username_too_long';
    throw err;
  }

  let salt = account.salt;
  let passwordHash = account.password_hash;
  if (newPassword !== undefined && newPassword !== null && newPassword !== '') {
    const value = String(newPassword);
    if (value.length < MIN_PASSWORD_LENGTH) {
      const err = new Error(`新密码至少 ${MIN_PASSWORD_LENGTH} 位`);
      err.code = 'weak_password';
      throw err;
    }
    salt = crypto.randomBytes(16).toString('hex');
    passwordHash = hashPassword(value, salt);
  }

  db.prepare(
    `UPDATE account SET username = ?, password_hash = ?, salt = ?, updated_at = ?
     WHERE id = 1`,
  ).run(nextUsername, passwordHash, salt, new Date().toISOString());

  return { username: nextUsername };
}

function isEnabled() {
  return true;
}

module.exports = {
  isEnabled,
  checkCredentials,
  changeAccount,
  getAccount,
  createToken,
  extractToken,
  verify,
  COOKIE_NAME,
  SESSION_TTL_MS,
  MIN_PASSWORD_LENGTH,
};
