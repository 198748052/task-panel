'use strict';

const crypto = require('node:crypto');

const PASSWORD = process.env.APP_PASSWORD || '';
const SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const COOKIE_NAME = 'tb_session';

const isEnabled = () => PASSWORD !== '';

function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', SECRET)
    .update(data)
    .digest('base64url');
  return `${data}.${sig}`;
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
    return payload;
  } catch {
    return null;
  }
}

function checkPassword(input) {
  if (!isEnabled()) return true;
  const a = Buffer.from(String(input ?? ''), 'utf8');
  const b = Buffer.from(PASSWORD, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function createToken() {
  return sign({ exp: Date.now() + SESSION_TTL_MS });
}

module.exports = {
  isEnabled,
  checkPassword,
  createToken,
  verify,
  COOKIE_NAME,
  SESSION_TTL_MS,
};
