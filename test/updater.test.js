'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'task-board-updater-'));
const updater = require('../src/updater');
const { reconcileStatus, tryAcquireLock, releaseLock } = updater._internal;

const LOCK_FILE = path.join(process.env.DATA_DIR, 'update.lock');

test('reconcileStatus finishes a handing_over update as done', () => {
  const result = reconcileStatus({ status: 'running', step: 'handing_over', toVersion: 'abc1234' });
  assert.equal(result.status, 'done');
  assert.equal(result.step, 'done');
  assert.equal(result.message, '更新完成，服务已重启');
});

test('reconcileStatus keeps an interrupted install as interrupted', () => {
  const result = reconcileStatus({ status: 'running', step: 'installing', toVersion: 'abc1234' });
  assert.equal(result.status, 'interrupted');
  assert.equal(result.step, 'interrupted');
});

test('reconcileStatus leaves terminal statuses untouched', () => {
  const done = reconcileStatus({ status: 'done', step: 'done' });
  assert.equal(done.status, 'done');
  const idle = reconcileStatus({});
  assert.deepEqual(idle, {});
});

test('tryAcquireLock is exclusive and release frees it', () => {
  releaseLock();
  assert.equal(tryAcquireLock(), true);
  assert.equal(tryAcquireLock(), false);
  releaseLock();
  assert.equal(tryAcquireLock(), true);
  releaseLock();
});

test('tryAcquireLock takes over a stale lock', () => {
  releaseLock();
  fs.writeFileSync(
    LOCK_FILE,
    JSON.stringify({ pid: 999999, startedAt: Date.now() - 60 * 60 * 1000 }),
  );
  assert.equal(tryAcquireLock(), true);
  releaseLock();
});
