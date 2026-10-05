'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const exporter = require('../src/export');

function sampleSnapshot() {
  return [
    {
      id: 1,
      title: '任务 一/带斜杠',
      description: '描述\n第二行',
      color: 'blue',
      archived: true,
      sort_order: 1,
      created_at: '2026-10-01T00:00:00.000Z',
      updated_at: '2026-10-02T00:00:00.000Z',
      nodes: [
        {
          id: 10,
          title: '节点A',
          content: '节点内容',
          done: false,
          sort_order: 1,
          created_at: '2026-10-01T00:00:00.000Z',
          updated_at: '2026-10-01T00:00:00.000Z',
          attachments: [
            {
              id: 100,
              storage: 'local',
              stored_name: 'a.png',
              original_name: '截图.png',
              mime_type: 'image/png',
              size: 1,
              url: null,
            },
            {
              id: 101,
              storage: 'r2',
              stored_name: 'k/y.pdf',
              original_name: '文档.pdf',
              mime_type: 'application/pdf',
              size: 2,
              url: 'https://cdn.example.com/k/y.pdf',
            },
          ],
        },
      ],
    },
  ];
}

test('sanitizeSegment removes unsafe characters and empty names', () => {
  assert.equal(exporter.sanitizeSegment('a/b\\c:d*e?f"g<h>i|j'), 'a_b_c_d_e_f_g_h_i_j');
  assert.equal(exporter.sanitizeSegment('\u0001weird\u001fname'), 'weirdname');
  assert.equal(exporter.sanitizeSegment('   '), 'untitled');
  assert.equal(exporter.sanitizeSegment('../../etc/passwd'), '_.._etc_passwd');
});

test('zip names carry the id prefix for uniqueness', () => {
  assert.equal(
    exporter.attachmentZipName({ id: 7, original_name: 'a/b.png' }),
    'attachments/0007_a_b.png',
  );
  assert.equal(
    exporter.markdownZipName({ id: 12, title: '任务/一' }),
    'markdown/0012_任务_一.md',
  );
});

test('buildData reports counts, file paths and r2 urls', () => {
  const fileMap = new Map([[100, 'attachments/0100_截图.png']]);
  const data = exporter.buildData(sampleSnapshot(), fileMap);

  assert.equal(data.schemaVersion, exporter.SCHEMA_VERSION);
  assert.equal(data.app, exporter.APP_NAME);
  assert.deepEqual(data.counts, { tasks: 1, nodes: 1, attachments: 2 });

  const atts = data.tasks[0].nodes[0].attachments;
  assert.equal(atts[0].file, 'attachments/0100_截图.png');
  assert.equal(atts[0].url, null);
  assert.equal(atts[1].file, null);
  assert.equal(atts[1].url, 'https://cdn.example.com/k/y.pdf');
});

test('taskToMarkdown inlines content and lists attachments', () => {
  const fileMap = new Map([[100, 'attachments/0100_截图.png']]);
  const md = exporter.taskToMarkdown(sampleSnapshot()[0], fileMap);

  assert.ok(md.includes('# 任务 一/带斜杠'));
  assert.ok(md.includes('节点内容'));
  assert.ok(md.includes('> 描述'));
  assert.ok(md.includes('attachments/0100_截图.png'));
  assert.ok(md.includes('https://cdn.example.com/k/y.pdf'));
});
