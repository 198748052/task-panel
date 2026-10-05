'use strict';

const crypto = require('node:crypto');
const { db, UPLOAD_DIR } = require('./db');
const storage = require('./storage');

const now = () => new Date().toISOString();

const RETENTION_DAYS = Math.max(1, Number(process.env.TRASH_RETENTION_DAYS || 30));
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

function transactional(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function nextOrder(table, where = '', params = []) {
  const row = db
    .prepare(
      `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM ${table} ${where}`,
    )
    .get(...params);
  return row ? row.next : 1;
}

function prevOrder(table, where = '', params = []) {
  const row = db
    .prepare(
      `SELECT COALESCE(MIN(sort_order), 1) - 1 AS next FROM ${table} ${where}`,
    )
    .get(...params);
  return row ? row.next : 0;
}

/* ------------------------------- tasks ------------------------------- */

function listTasks() {
  const tasks = db
    .prepare(
      'SELECT * FROM tasks WHERE deleted_at IS NULL ORDER BY archived ASC, sort_order ASC, id ASC',
    )
    .all();
  const nodes = db
    .prepare(
      'SELECT * FROM nodes WHERE deleted_at IS NULL ORDER BY sort_order ASC, id ASC',
    )
    .all();
  const atts = db
    .prepare(
      'SELECT * FROM attachments WHERE deleted_at IS NULL ORDER BY id ASC',
    )
    .all();

  const attsByNode = new Map();
  for (const a of atts) {
    if (!attsByNode.has(a.node_id)) attsByNode.set(a.node_id, []);
    attsByNode.get(a.node_id).push(serializeAttachment(a));
  }

  const nodesByTask = new Map();
  for (const n of nodes) {
    const node = {
      ...n,
      done: !!n.done,
      attachments: attsByNode.get(n.id) || [],
    };
    if (!nodesByTask.has(n.task_id)) nodesByTask.set(n.task_id, []);
    nodesByTask.get(n.task_id).push(node);
  }

  return tasks.map((t) => ({
    ...t,
    archived: !!t.archived,
    nodes: nodesByTask.get(t.id) || [],
  }));
}

function exportSnapshot() {
  const tasks = db
    .prepare(
      'SELECT * FROM tasks WHERE deleted_at IS NULL ORDER BY archived ASC, sort_order ASC, id ASC',
    )
    .all();
  const nodes = db
    .prepare(
      'SELECT * FROM nodes WHERE deleted_at IS NULL ORDER BY sort_order ASC, id ASC',
    )
    .all();
  const atts = db
    .prepare(
      'SELECT * FROM attachments WHERE deleted_at IS NULL ORDER BY id ASC',
    )
    .all();

  const attsByNode = new Map();
  for (const a of atts) {
    const kind = a.storage || 'local';
    if (!attsByNode.has(a.node_id)) attsByNode.set(a.node_id, []);
    attsByNode.get(a.node_id).push({
      id: a.id,
      node_id: a.node_id,
      stored_name: a.stored_name,
      original_name: a.original_name,
      mime_type: a.mime_type,
      size: a.size,
      storage: kind,
      url: kind === 'r2' ? storage.publicUrl(a.stored_name) : null,
      created_at: a.created_at,
    });
  }

  const nodesByTask = new Map();
  for (const n of nodes) {
    const node = {
      id: n.id,
      task_id: n.task_id,
      title: n.title,
      content: n.content,
      done: !!n.done,
      sort_order: n.sort_order,
      created_at: n.created_at,
      updated_at: n.updated_at,
      attachments: attsByNode.get(n.id) || [],
    };
    if (!nodesByTask.has(n.task_id)) nodesByTask.set(n.task_id, []);
    nodesByTask.get(n.task_id).push(node);
  }

  return tasks.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    color: t.color,
    archived: !!t.archived,
    sort_order: t.sort_order,
    created_at: t.created_at,
    updated_at: t.updated_at,
    nodes: nodesByTask.get(t.id) || [],
  }));
}

function getTask(id) {
  return db
    .prepare('SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL')
    .get(Number(id));
}

function createTask({ title, description = '', color = 'blue' }) {
  const ts = now();
  const info = db
    .prepare(
      `INSERT INTO tasks (title, description, color, archived, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?, ?)`,
    )
    .run(
      String(title).trim(),
      String(description ?? ''),
      String(color || 'blue'),
      nextOrder('tasks'),
      ts,
      ts,
    );
  return getTask(Number(info.lastInsertRowid));
}

function updateTask(id, fields) {
  const current = getTask(id);
  if (!current) return null;
  const allowed = ['title', 'description', 'color', 'archived'];
  const sets = [];
  const params = [];
  for (const key of allowed) {
    if (fields[key] === undefined) continue;
    let value = fields[key];
    if (key === 'archived') value = value ? 1 : 0;
    if (key === 'title') value = String(value).trim();
    sets.push(`${key} = ?`);
    params.push(value);
  }
  if (!sets.length) return current;
  sets.push('updated_at = ?');
  params.push(now(), Number(id));
  db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getTask(id);
}

function trashTask(id) {
  const target = getTask(id);
  if (!target) return null;
  const ts = now();
  const batch = crypto.randomUUID();
  return transactional(() => {
    db.prepare(
      'UPDATE tasks SET deleted_at = ?, delete_batch = ? WHERE id = ?',
    ).run(ts, batch, Number(id));
    const nodeIds = db
      .prepare(
        'SELECT id FROM nodes WHERE task_id = ? AND deleted_at IS NULL',
      )
      .all(Number(id))
      .map((r) => r.id);
    if (nodeIds.length) {
      const ph = nodeIds.map(() => '?').join(',');
      db.prepare(
        `UPDATE nodes SET deleted_at = ?, delete_batch = ? WHERE id IN (${ph})`,
      ).run(ts, batch, ...nodeIds);
      db.prepare(
        `UPDATE attachments SET deleted_at = ?, delete_batch = ?
         WHERE node_id IN (${ph}) AND deleted_at IS NULL`,
      ).run(ts, batch, ...nodeIds);
    }
    return { batch };
  });
}

function reorderTasks(ids) {
  return transactional(() => {
    const stmt = db.prepare('UPDATE tasks SET sort_order = ? WHERE id = ?');
    ids.forEach((id, index) => stmt.run(index + 1, Number(id)));
    return true;
  });
}

/* ------------------------------- nodes ------------------------------- */

function getNode(id) {
  return db
    .prepare('SELECT * FROM nodes WHERE id = ? AND deleted_at IS NULL')
    .get(Number(id));
}

function createNode(taskId, { title, content = '' }) {
  if (!getTask(taskId)) return null;
  const ts = now();
  const info = db
    .prepare(
      `INSERT INTO nodes (task_id, title, content, done, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?, ?)`,
    )
    .run(
      Number(taskId),
      String(title).trim(),
      String(content ?? ''),
      prevOrder('nodes', 'WHERE task_id = ?', [Number(taskId)]),
      ts,
      ts,
    );
  db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(ts, Number(taskId));
  return serializeNode(getNode(Number(info.lastInsertRowid)));
}

function updateNode(id, fields) {
  const current = getNode(id);
  if (!current) return null;
  const allowed = ['title', 'content', 'done'];
  const sets = [];
  const params = [];
  for (const key of allowed) {
    if (fields[key] === undefined) continue;
    let value = fields[key];
    if (key === 'done') value = value ? 1 : 0;
    if (key === 'title') value = String(value).trim();
    sets.push(`${key} = ?`);
    params.push(value);
  }
  if (!sets.length) return serializeNode(current);
  const ts = now();
  sets.push('updated_at = ?');
  params.push(ts, Number(id));
  db.prepare(`UPDATE nodes SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(ts, current.task_id);
  return serializeNode(getNode(id));
}

function trashNode(id) {
  const current = getNode(id);
  if (!current) return null;
  const ts = now();
  const batch = crypto.randomUUID();
  return transactional(() => {
    db.prepare(
      'UPDATE nodes SET deleted_at = ?, delete_batch = ? WHERE id = ?',
    ).run(ts, batch, Number(id));
    db.prepare(
      `UPDATE attachments SET deleted_at = ?, delete_batch = ?
       WHERE node_id = ? AND deleted_at IS NULL`,
    ).run(ts, batch, Number(id));
    db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(ts, current.task_id);
    return { batch };
  });
}

function reorderNodes(ids) {
  return transactional(() => {
    const stmt = db.prepare('UPDATE nodes SET sort_order = ? WHERE id = ?');
    ids.forEach((id, index) => stmt.run(index + 1, Number(id)));
    return true;
  });
}

function serializeNode(row) {
  const attachments = db
    .prepare(
      'SELECT * FROM attachments WHERE node_id = ? AND deleted_at IS NULL ORDER BY id ASC',
    )
    .all(row.id)
    .map(serializeAttachment);
  return { ...row, done: !!row.done, attachments };
}

/* ---------------------------- attachments ---------------------------- */

function serializeAttachment(row) {
  const kind = row.storage || 'local';
  return {
    id: row.id,
    node_id: row.node_id,
    original_name: row.original_name,
    mime_type: row.mime_type,
    size: row.size,
    storage: kind,
    url: kind === 'r2' ? storage.publicUrl(row.stored_name) : null,
    created_at: row.created_at,
  };
}

function addAttachment(nodeId, file) {
  const node = getNode(nodeId);
  if (!node) return null;
  const ts = now();
  const originalName =
    Buffer.from(file.originalname, 'latin1').toString('utf8') ||
    file.originalname;
  const info = db
    .prepare(
      `INSERT INTO attachments (node_id, stored_name, original_name, mime_type, size, storage, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      Number(nodeId),
      file.storedName,
      originalName,
      file.mimeType || 'application/octet-stream',
      file.size || 0,
      file.storage || 'local',
      ts,
    );
  db.prepare('UPDATE nodes SET updated_at = ? WHERE id = ?').run(ts, Number(nodeId));
  const row = db
    .prepare('SELECT * FROM attachments WHERE id = ?')
    .get(Number(info.lastInsertRowid));
  return serializeAttachment(row);
}

function getAttachment(id) {
  return db.prepare('SELECT * FROM attachments WHERE id = ?').get(Number(id));
}

function updateAttachment(id, fields) {
  const att = getAttachment(id);
  if (!att || att.deleted_at) return null;
  if (fields.original_name !== undefined) {
    const name =
      String(fields.original_name).trim().slice(0, 255) || att.original_name;
    db.prepare('UPDATE attachments SET original_name = ? WHERE id = ?').run(name, Number(id));
    db.prepare('UPDATE nodes SET updated_at = ? WHERE id = ?').run(now(), att.node_id);
  }
  return serializeAttachment(getAttachment(id));
}

function trashAttachment(id) {
  const att = getAttachment(id);
  if (!att || att.deleted_at) return null;
  const ts = now();
  const batch = crypto.randomUUID();
  db.prepare(
    'UPDATE attachments SET deleted_at = ?, delete_batch = ? WHERE id = ?',
  ).run(ts, batch, Number(id));
  db.prepare('UPDATE nodes SET updated_at = ? WHERE id = ?').run(ts, att.node_id);
  return { batch };
}

/* ------------------------------- trash ------------------------------- */

function serializeTrashGroup(batch, type, title, parent, deletedAt, counts) {
  const deletedMs = new Date(deletedAt).getTime();
  const expireMs = deletedMs + RETENTION_MS;
  return {
    batch,
    type,
    title,
    parent,
    deleted_at: deletedAt,
    expires_at: new Date(expireMs).toISOString(),
    days_left: Math.max(0, Math.ceil((expireMs - Date.now()) / 86400000)),
    nodes: counts.nodes,
    attachments: counts.attachments,
  };
}

function listTrash() {
  const tasks = db
    .prepare('SELECT * FROM tasks WHERE deleted_at IS NOT NULL')
    .all();
  const nodes = db
    .prepare('SELECT * FROM nodes WHERE deleted_at IS NOT NULL')
    .all();
  const atts = db
    .prepare('SELECT * FROM attachments WHERE deleted_at IS NOT NULL')
    .all();

  const groups = new Map();
  const groupOf = (batch) => {
    if (!groups.has(batch)) {
      groups.set(batch, { batch, task: null, nodes: [], attachments: [] });
    }
    return groups.get(batch);
  };
  for (const t of tasks) groupOf(t.delete_batch).task = t;
  for (const n of nodes) groupOf(n.delete_batch).nodes.push(n);
  for (const a of atts) groupOf(a.delete_batch).attachments.push(a);

  const taskTitle = db.prepare('SELECT title FROM tasks WHERE id = ?');
  const nodeInfo = db.prepare('SELECT task_id, title FROM nodes WHERE id = ?');

  const items = [];
  for (const g of groups.values()) {
    if (g.task) {
      items.push(
        serializeTrashGroup(g.batch, 'task', g.task.title, '', g.task.deleted_at, {
          nodes: g.nodes.length,
          attachments: g.attachments.length,
        }),
      );
    } else if (g.nodes.length) {
      const node = g.nodes[0];
      const task = taskTitle.get(node.task_id);
      items.push(
        serializeTrashGroup(g.batch, 'node', node.title, task ? task.title : '', node.deleted_at, {
          nodes: g.nodes.length,
          attachments: g.attachments.length,
        }),
      );
    } else if (g.attachments.length) {
      const att = g.attachments[0];
      const node = nodeInfo.get(att.node_id);
      const task = node ? taskTitle.get(node.task_id) : null;
      const parent = node
        ? `${task ? `${task.title} / ` : ''}${node.title}`
        : '';
      items.push(
        serializeTrashGroup(
          g.batch,
          'attachment',
          att.original_name,
          parent,
          att.deleted_at,
          { nodes: 0, attachments: g.attachments.length },
        ),
      );
    }
  }
  items.sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));
  return items;
}

function restoreTrash(batch) {
  const exists = ['tasks', 'nodes', 'attachments'].some((table) =>
    db.prepare(`SELECT 1 FROM ${table} WHERE delete_batch = ? LIMIT 1`).get(batch),
  );
  if (!exists) return false;
  return transactional(() => {
    const taskIds = new Set(
      db.prepare('SELECT id FROM tasks WHERE delete_batch = ?').all(batch).map((r) => r.id),
    );
    const nodeIds = new Set(
      db.prepare('SELECT id FROM nodes WHERE delete_batch = ?').all(batch).map((r) => r.id),
    );
    const attIds = db
      .prepare('SELECT id FROM attachments WHERE delete_batch = ?')
      .all(batch)
      .map((r) => r.id);

    for (const nid of nodeIds) {
      const n = db.prepare('SELECT task_id FROM nodes WHERE id = ?').get(nid);
      if (n) taskIds.add(n.task_id);
    }
    for (const aid of attIds) {
      const a = db.prepare('SELECT node_id FROM attachments WHERE id = ?').get(aid);
      if (!a) continue;
      nodeIds.add(a.node_id);
      const n = db.prepare('SELECT task_id FROM nodes WHERE id = ?').get(a.node_id);
      if (n) taskIds.add(n.task_id);
    }

    const clear = (table, ids) => {
      if (!ids.size) return;
      const list = [...ids];
      const ph = list.map(() => '?').join(',');
      db.prepare(
        `UPDATE ${table} SET deleted_at = NULL, delete_batch = NULL WHERE id IN (${ph})`,
      ).run(...list);
    };
    clear('tasks', taskIds);
    clear('nodes', nodeIds);
    if (attIds.length) {
      const ph = attIds.map(() => '?').join(',');
      db.prepare(
        `UPDATE attachments SET deleted_at = NULL, delete_batch = NULL WHERE id IN (${ph})`,
      ).run(...attIds);
    }
    return true;
  });
}

function purgeTrash(batch) {
  const taskIds = db
    .prepare('SELECT id FROM tasks WHERE delete_batch = ?')
    .all(batch)
    .map((r) => r.id);
  const nodeIds = db
    .prepare('SELECT id FROM nodes WHERE delete_batch = ?')
    .all(batch)
    .map((r) => r.id);

  if (!taskIds.length && !nodeIds.length) {
    const atts = db
      .prepare(
        'SELECT stored_name, storage FROM attachments WHERE delete_batch = ?',
      )
      .all(batch);
    if (!atts.length) return null;
    return transactional(() => {
      db.prepare('DELETE FROM attachments WHERE delete_batch = ?').run(batch);
      return atts.map((a) => ({ stored_name: a.stored_name, storage: a.storage }));
    });
  }

  const files = new Map();
  const descendantNodes = new Set(nodeIds);
  if (taskIds.length) {
    const ph = taskIds.map(() => '?').join(',');
    for (const r of db
      .prepare(`SELECT id FROM nodes WHERE task_id IN (${ph})`)
      .all(...taskIds)) {
      descendantNodes.add(r.id);
    }
  }
  const nodeList = [...descendantNodes];
  if (nodeList.length) {
    const ph = nodeList.map(() => '?').join(',');
    for (const r of db
      .prepare(
        `SELECT stored_name, storage FROM attachments WHERE node_id IN (${ph})`,
      )
      .all(...nodeList)) {
      files.set(`${r.storage || 'local'}:${r.stored_name}`, {
        stored_name: r.stored_name,
        storage: r.storage,
      });
    }
  }

  return transactional(() => {
    if (taskIds.length) {
      const ph = taskIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM tasks WHERE id IN (${ph})`).run(...taskIds);
    }
    if (nodeIds.length) {
      const ph = nodeIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM nodes WHERE id IN (${ph})`).run(...nodeIds);
    }
    db.prepare('DELETE FROM attachments WHERE delete_batch = ?').run(batch);
    return [...files.values()];
  });
}

function listBatches(where, params = []) {
  const batches = new Set();
  for (const table of ['tasks', 'nodes', 'attachments']) {
    for (const row of db
      .prepare(`SELECT DISTINCT delete_batch FROM ${table} WHERE ${where}`)
      .all(...params)) {
      if (row.delete_batch) batches.add(row.delete_batch);
    }
  }
  return batches;
}

function emptyTrash() {
  const files = [];
  for (const batch of listBatches('delete_batch IS NOT NULL')) {
    const f = purgeTrash(batch);
    if (f) files.push(...f);
  }
  return files;
}

function purgeExpired() {
  const cutoff = new Date(Date.now() - RETENTION_MS).toISOString();
  const files = [];
  for (const batch of listBatches(
    'deleted_at IS NOT NULL AND deleted_at < ?',
    [cutoff],
  )) {
    const f = purgeTrash(batch);
    if (f) files.push(...f);
  }
  return files;
}

module.exports = {
  UPLOAD_DIR,
  RETENTION_DAYS,
  listTasks,
  exportSnapshot,
  getTask,
  createTask,
  updateTask,
  trashTask,
  reorderTasks,
  getNode,
  createNode,
  updateNode,
  trashNode,
  reorderNodes,
  addAttachment,
  getAttachment,
  updateAttachment,
  trashAttachment,
  listTrash,
  restoreTrash,
  purgeTrash,
  emptyTrash,
  purgeExpired,
};
