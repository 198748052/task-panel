'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} = require('@aws-sdk/client-s3');
const settings = require('./settings');

const FIELDS = [
  'accountId',
  'accessKeyId',
  'secretAccessKey',
  'bucket',
  'publicBaseUrl',
  'endpoint',
  'region',
  'prefix',
  'forcePathStyle',
];

const ENV_KEYS = {
  accountId: 'R2_ACCOUNT_ID',
  accessKeyId: 'R2_ACCESS_KEY_ID',
  secretAccessKey: 'R2_SECRET_ACCESS_KEY',
  bucket: 'R2_BUCKET',
  publicBaseUrl: 'R2_PUBLIC_BASE_URL',
  endpoint: 'R2_ENDPOINT',
  region: 'R2_REGION',
  prefix: 'R2_PREFIX',
  forcePathStyle: 'R2_FORCE_PATH_STYLE',
};

let configCache = { rev: 0, cfg: null, sources: null };
let clientCache = { sig: null, client: null };

function normalizeBase(value) {
  return String(value || '').replace(/\/+$/, '');
}

function normalizeCfg(cfg) {
  cfg.region = cfg.region || 'auto';
  cfg.prefix = (cfg.prefix || 'attachments').replace(/^\/+|\/+$/g, '');
  cfg.publicBaseUrl = normalizeBase(cfg.publicBaseUrl);
  cfg.endpoint = normalizeBase(cfg.endpoint);
  if (!cfg.endpoint && cfg.accountId) {
    cfg.endpoint = `https://${cfg.accountId}.r2.cloudflarestorage.com`;
  }
  const fps = String(cfg.forcePathStyle).toLowerCase();
  cfg.forcePathStyle = !(fps === '0' || fps === 'false');
  return cfg;
}

function resolveConfig() {
  const rev = settings.getRevision();
  if (configCache.cfg && configCache.rev === rev) return configCache;

  const stored = settings.getAll();
  const cfg = {};
  const sources = {};
  for (const field of FIELDS) {
    const storedValue = stored[`r2.${field}`];
    const envValue = process.env[ENV_KEYS[field]];
    if (storedValue !== undefined && storedValue !== '') {
      cfg[field] = storedValue;
      sources[field] = 'db';
    } else if (envValue !== undefined && envValue !== '') {
      cfg[field] = envValue;
      sources[field] = 'env';
    } else {
      cfg[field] = '';
      sources[field] = 'none';
    }
  }
  normalizeCfg(cfg);
  configCache = { rev, cfg, sources };
  return configCache;
}

function isConfigured() {
  const { cfg } = resolveConfig();
  return Boolean(
    cfg.endpoint && cfg.accessKeyId && cfg.secretAccessKey && cfg.bucket && cfg.publicBaseUrl,
  );
}

function clientFor(cfg) {
  const sig = JSON.stringify([
    cfg.endpoint,
    cfg.region,
    cfg.accessKeyId,
    cfg.secretAccessKey,
    cfg.forcePathStyle,
  ]);
  if (clientCache.client && clientCache.sig === sig) return clientCache.client;
  const client = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    forcePathStyle: cfg.forcePathStyle,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
  clientCache = { sig, client };
  return client;
}

function getPublicConfig() {
  const { cfg, sources } = resolveConfig();
  return {
    enabled: isConfigured(),
    values: {
      accountId: cfg.accountId,
      accessKeyId: cfg.accessKeyId,
      bucket: cfg.bucket,
      publicBaseUrl: cfg.publicBaseUrl,
      endpoint: cfg.endpoint,
      region: cfg.region,
      prefix: cfg.prefix,
      forcePathStyle: cfg.forcePathStyle,
    },
    hasSecret: Boolean(cfg.secretAccessKey),
    secretSource: sources.secretAccessKey,
    sources,
  };
}

function updateConfig(input = {}) {
  for (const field of FIELDS) {
    if (field === 'secretAccessKey') {
      if (
        typeof input.secretAccessKey === 'string' &&
        input.secretAccessKey.trim() !== ''
      ) {
        settings.set('r2.secretAccessKey', input.secretAccessKey.trim());
      } else if (input.clearSecret === true) {
        settings.set('r2.secretAccessKey', '');
      }
      continue;
    }
    if (input[field] === undefined) continue;
    let value = input[field];
    if (field === 'forcePathStyle') value = value ? '1' : '0';
    settings.set(`r2.${field}`, String(value ?? '').trim());
  }
  return getPublicConfig();
}

function buildConfig(overrides = {}) {
  const base = resolveConfig().cfg;
  const cfg = { ...base };
  for (const field of FIELDS) {
    if (field === 'secretAccessKey') {
      if (
        typeof overrides.secretAccessKey === 'string' &&
        overrides.secretAccessKey.trim() !== ''
      ) {
        cfg.secretAccessKey = overrides.secretAccessKey.trim();
      }
      continue;
    }
    if (overrides[field] === undefined) continue;
    let value = overrides[field];
    if (field === 'forcePathStyle') value = value ? '1' : '0';
    const text = String(value ?? '').trim();
    if (text !== '') cfg[field] = text;
  }
  return normalizeCfg(cfg);
}

async function testConfig(overrides = {}) {
  const cfg = buildConfig(overrides);
  if (!cfg.endpoint) throw new Error('缺少 Endpoint 或 Account ID');
  if (!cfg.accessKeyId || !cfg.secretAccessKey) {
    throw new Error('缺少 Access Key ID 或 Secret Access Key');
  }
  if (!cfg.bucket) throw new Error('缺少 Bucket');
  const client = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    forcePathStyle: cfg.forcePathStyle,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
  await client.send(new HeadBucketCommand({ Bucket: cfg.bucket }));
  return { ok: true, bucket: cfg.bucket };
}

function makeKey(filename) {
  const { cfg } = resolveConfig();
  const ext = path.extname(filename || '').slice(0, 16);
  const name = `${crypto.randomUUID()}${ext}`;
  return cfg.prefix ? `${cfg.prefix}/${name}` : name;
}

async function putObject(key, body, contentType, contentLength) {
  const { cfg } = resolveConfig();
  const params = {
    Bucket: cfg.bucket,
    Key: key,
    Body: body,
    ContentType: contentType || 'application/octet-stream',
  };
  if (contentLength) params.ContentLength = contentLength;
  await clientFor(cfg).send(new PutObjectCommand(params));
  return key;
}

async function deleteObject(key) {
  const { cfg } = resolveConfig();
  await clientFor(cfg).send(
    new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }),
  );
}

async function getObject(key) {
  const { cfg } = resolveConfig();
  const out = await clientFor(cfg).send(
    new GetObjectCommand({ Bucket: cfg.bucket, Key: key }),
  );
  return {
    body: out.Body,
    contentType: out.ContentType || null,
    contentLength: out.ContentLength ?? null,
    etag: out.ETag || null,
    lastModified: out.LastModified || null,
  };
}

function publicUrl(key) {
  const { cfg } = resolveConfig();
  if (!cfg.publicBaseUrl || !key) return null;
  return `${cfg.publicBaseUrl}/${key}`;
}

module.exports = {
  isConfigured,
  getPublicConfig,
  updateConfig,
  testConfig,
  makeKey,
  putObject,
  getObject,
  deleteObject,
  publicUrl,
};
