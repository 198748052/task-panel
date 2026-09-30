'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'app.db');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(DB_FILE);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    color       TEXT    NOT NULL DEFAULT 'blue',
    archived    INTEGER NOT NULL DEFAULT 0,
    sort_order  REAL    NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS nodes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    title      TEXT    NOT NULL,
    content    TEXT    NOT NULL DEFAULT '',
    done       INTEGER NOT NULL DEFAULT 0,
    sort_order REAL    NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL,
    updated_at TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS attachments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id       INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    stored_name   TEXT    NOT NULL,
    original_name TEXT    NOT NULL,
    mime_type     TEXT    NOT NULL DEFAULT '',
    size          INTEGER NOT NULL DEFAULT 0,
    storage       TEXT    NOT NULL DEFAULT 'local',
    created_at    TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_nodes_task ON nodes(task_id);
  CREATE INDEX IF NOT EXISTS idx_attachments_node ON attachments(node_id);
`);

/* ------------------------------- migration ---------------------------- */

function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

for (const table of ['tasks', 'nodes', 'attachments']) {
  ensureColumn(table, 'deleted_at', 'deleted_at TEXT');
  ensureColumn(table, 'delete_batch', 'delete_batch TEXT');
}
ensureColumn('attachments', 'storage', "storage TEXT NOT NULL DEFAULT 'local'");

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_tasks_deleted ON tasks(deleted_at);
  CREATE INDEX IF NOT EXISTS idx_nodes_deleted ON nodes(deleted_at);
  CREATE INDEX IF NOT EXISTS idx_attachments_deleted ON attachments(deleted_at);
  CREATE INDEX IF NOT EXISTS idx_tasks_batch ON tasks(delete_batch);
  CREATE INDEX IF NOT EXISTS idx_nodes_batch ON nodes(delete_batch);
  CREATE INDEX IF NOT EXISTS idx_attachments_batch ON attachments(delete_batch);
`);

module.exports = { db, DATA_DIR, UPLOAD_DIR, DB_FILE };
