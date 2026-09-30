'use strict';

const { db } = require('./db');

const now = () => new Date().toISOString();

let revision = 1;

function get(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row && row.value !== '' ? row.value : fallback;
}

function set(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(String(key), String(value ?? ''), now());
  revision += 1;
}

function getAll() {
  const out = {};
  for (const row of db.prepare('SELECT key, value FROM settings').all()) {
    out[row.key] = row.value;
  }
  return out;
}

function getRevision() {
  return revision;
}

module.exports = { get, set, getAll, getRevision };
