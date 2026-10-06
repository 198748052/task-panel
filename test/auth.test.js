'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'task-board-auth-'));
process.env.SESSION_SECRET = 'test-secret';

const auth = require('../src/auth');

test('extractToken prefers the cookie over the Authorization header', () => {
  const req = {
    cookies: { [auth.COOKIE_NAME]: 'cookie-token' },
    headers: { authorization: 'Bearer header-token' },
  };
  assert.equal(auth.extractToken(req), 'cookie-token');
});

test('extractToken reads a Bearer header through req.get', () => {
  const req = {
    cookies: {},
    get: (name) =>
      String(name).toLowerCase() === 'authorization' ? 'Bearer token-1' : '',
  };
  assert.equal(auth.extractToken(req), 'token-1');
});

test('extractToken matches the Bearer scheme case-insensitively', () => {
  const req = { headers: { authorization: 'bearer TOKEN-2' } };
  assert.equal(auth.extractToken(req), 'TOKEN-2');
});

test('extractToken returns an empty string without credentials', () => {
  assert.equal(auth.extractToken({ headers: {} }), '');
  assert.equal(auth.extractToken(null), '');
});

test('createToken round-trips through verify', () => {
  const payload = auth.verify(auth.createToken());
  assert.ok(payload, 'token should verify');
  assert.ok(payload.exp > Date.now(), 'token should not be expired');
});

test('verify rejects a tampered token', () => {
  const token = auth.createToken();
  const last = token.slice(-1);
  const tampered = `${token.slice(0, -1)}${last === 'a' ? 'b' : 'a'}`;
  assert.equal(auth.verify(tampered), null);
});

test('changing the password invalidates previously issued tokens', () => {
  const token = auth.createToken();
  assert.ok(auth.verify(token));
  auth.changeAccount({
    username: 'admin',
    currentPassword: 'admin123',
    newPassword: 'newpass123',
  });
  assert.equal(auth.verify(token), null);
  assert.ok(auth.verify(auth.createToken()));
});
