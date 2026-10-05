'use strict';

const fs = require('node:fs');
const path = require('node:path');
const archiver = require('archiver');

const APP_NAME = 'task-board';
const SCHEMA_VERSION = 1;

function sanitizeSegment(name) {
  const cleaned = String(name ?? '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 120);
  return cleaned || 'untitled';
}

function attachmentZipName(att) {
  const id = String(att.id).padStart(4, '0');
  return `attachments/${id}_${sanitizeSegment(att.original_name)}`;
}

function markdownZipName(task) {
  const id = String(task.id).padStart(4, '0');
  return `markdown/${id}_${sanitizeSegment(task.title)}.md`;
}

function buildData(snapshot, fileMap = new Map()) {
  const counts = { tasks: 0, nodes: 0, attachments: 0 };
  const tasks = snapshot.map((task) => {
    counts.tasks += 1;
    const nodes = task.nodes.map((node) => {
      counts.nodes += 1;
      const attachments = node.attachments.map((att) => {
        counts.attachments += 1;
        return {
          id: att.id,
          original_name: att.original_name,
          mime_type: att.mime_type,
          size: att.size,
          storage: att.storage,
          file: fileMap.has(att.id) ? fileMap.get(att.id) : null,
          url: att.url || null,
          created_at: att.created_at,
        };
      });
      return {
        id: node.id,
        title: node.title,
        content: node.content,
        done: node.done,
        sort_order: node.sort_order,
        created_at: node.created_at,
        updated_at: node.updated_at,
        attachments,
      };
    });
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      color: task.color,
      archived: task.archived,
      sort_order: task.sort_order,
      created_at: task.created_at,
      updated_at: task.updated_at,
      nodes,
    };
  });
  return {
    app: APP_NAME,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    counts,
    tasks,
  };
}

function taskToMarkdown(task, fileMap = new Map()) {
  const lines = [];
  lines.push(`# ${task.title || '未命名任务'}`);
  lines.push('');

  const meta = [
    `颜色：${task.color || 'blue'}`,
    `状态：${task.archived ? '已归档' : '进行中'}`,
  ];
  if (task.created_at) meta.push(`创建：${task.created_at}`);
  if (task.updated_at) meta.push(`更新：${task.updated_at}`);
  lines.push(meta.join(' · '));
  lines.push('');

  if (task.description) {
    lines.push(
      String(task.description)
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n'),
    );
    lines.push('');
  }

  const nodes = task.nodes || [];
  lines.push(`共 ${nodes.length} 个节点`);
  lines.push('');

  if (nodes.length === 0) {
    lines.push('_暂无节点_');
    lines.push('');
    return lines.join('\n');
  }

  nodes.forEach((node, index) => {
    lines.push(`## ${index + 1}. ${node.done ? '[x]' : '[ ]'} ${node.title || '未命名节点'}`);
    lines.push('');
    if (node.content) {
      lines.push(String(node.content));
      lines.push('');
    }
    const attachments = node.attachments || [];
    if (attachments.length) {
      lines.push('附件：');
      for (const att of attachments) {
        const label = att.original_name || `附件 ${att.id}`;
        let target = '';
        if (fileMap.has(att.id)) target = fileMap.get(att.id);
        else if (att.url) target = att.url;
        lines.push(`- ${label}${target ? ` （${target}）` : ''}`);
      }
      lines.push('');
    }
  });

  return lines.join('\n');
}

function buildArchive(writable, snapshot) {
  const { UPLOAD_DIR } = require('./db');
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const fileMap = new Map();
    const warnings = [];

    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') warnings.push(err.message);
      else reject(err);
    });
    archive.on('error', reject);
    archive.on('end', resolve);
    writable.on('close', resolve);

    archive.pipe(writable);

    for (const task of snapshot) {
      for (const node of task.nodes) {
        for (const att of node.attachments) {
          if (att.storage !== 'local') continue;
          const zipName = attachmentZipName(att);
          const diskPath = att.stored_name
            ? path.join(UPLOAD_DIR, att.stored_name)
            : '';
          if (diskPath && fs.existsSync(diskPath)) {
            fileMap.set(att.id, zipName);
            archive.file(diskPath, { name: zipName });
          } else {
            warnings.push(`附件文件缺失：${zipName}`);
          }
        }
      }
    }

    const data = buildData(snapshot, fileMap);
    const manifest = {
      app: APP_NAME,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: data.exportedAt,
      counts: { ...data.counts, files: fileMap.size },
      warnings,
    };

    archive.append(`${JSON.stringify(data, null, 2)}\n`, { name: 'data.json' });
    archive.append(`${JSON.stringify(manifest, null, 2)}\n`, {
      name: 'manifest.json',
    });
    for (const task of snapshot) {
      archive.append(`${taskToMarkdown(task, fileMap)}\n`, {
        name: markdownZipName(task),
      });
    }

    archive.finalize().catch(reject);
  });
}

module.exports = {
  APP_NAME,
  SCHEMA_VERSION,
  sanitizeSegment,
  attachmentZipName,
  markdownZipName,
  buildData,
  taskToMarkdown,
  buildArchive,
};
