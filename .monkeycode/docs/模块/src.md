# src/

后端领域模块：在 Express 之外完成持久化、鉴权、对象存储、导出与更新。`server.js` 只做 HTTP 适配。

## 结构

```
src/
├── env.js         # process.loadEnvFile
├── db.js          # DatabaseSync、建表、ensureColumn
├── store.js       # 任务树与回收站
├── auth.js        # 账号与会话令牌
├── settings.js    # settings KV
├── storage.js     # R2 S3 客户端
├── export.js      # ZIP 归档
└── updater.js     # Git 更新与进程交接
```

## 关键文件

| 文件 | 目的 |
|------|------|
| `db.js` | `DATA_DIR`/`UPLOAD_DIR`/`DB_FILE`，WAL，外键，迁移 |
| `store.js` | 全部任务领域 API，事务 `BEGIN/COMMIT` |
| `auth.js` | scrypt、HMAC 令牌、`extractToken` |
| `storage.js` | 配置合并（DB 覆盖 env）、put/get/delete、publicUrl |
| `updater.js` | 文件锁、update.log、execve 前 `closeHttpServer` |
| `export.js` | `SCHEMA_VERSION = 1`，sanitize 路径段 |

## 依赖

**本模块依赖**:
- `node:sqlite`、`node:crypto`、`node:fs`
- `@aws-sdk/client-s3`、`archiver`

**依赖本模块的**:
- `server.js`
- `test/*.test.js`

## 规范

- CommonJS，`'use strict'`
- 时间戳 ISO 字符串 `new Date().toISOString()`
- 找不到实体返回 `null`，由路由转 404
- 设置项用 `settings.get/set`，R2 与 deploy remote 都走这张表

## 添加新文件

1. 在 `src/` 新增职责单一的模块
2. `server.js` require 并挂路由
3. 纯函数可在 `test/` 覆盖
4. 不要在 `src` 里读 HTTP 对象（`auth.extractToken` 是已有的窄适配）
