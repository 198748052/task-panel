# 开发者指南

## 项目目的

task-panel 是自托管个人任务看板。仓库包含 Express 后端与无构建的静态 Web 前端。

**核心职责**:
- 单账号鉴权下的任务 / 节点 / 附件 CRUD
- 软删除回收站与定时彻底清除
- 可选 Cloudflare R2 附件
- Git 一键更新当前部署目录
- 全量 ZIP 导出

**相关系统**:
- Cloudflare R2 — 可选对象存储，S3 API
- Git origin — `src/updater.js` 拉取更新

## 环境搭建

### 前置条件

- Node.js >= 22.5.0（`node:sqlite`、`process.loadEnvFile`）
- npm
- 可选：本机 `git`（一键更新）、Cloudflare R2 凭证

### 安装

```bash
# 克隆仓库
git clone https://github.com/198748052/task-panel
cd task-panel

# 安装依赖
npm install

# 配置环境
cp .env.example .env
```

### 环境变量

由 `src/env.js` 在启动时 `process.loadEnvFile`。已存在的进程环境变量优先于 `.env` 文件。

| 变量 | 必需 | 描述 | 示例 |
|------|------|------|------|
| `APP_USERNAME` | 否 | 仅当 `account` 表为空时播种 | `admin` |
| `APP_PASSWORD` | 否 | 同上 | `admin123` |
| `SESSION_SECRET` | 建议 | HMAC 签名密钥；未设则每次启动随机，登录全部失效 | 随机串 |
| `PORT` | 否 | 监听端口 | `3000` |
| `HOST` | 否 | 监听地址 | `0.0.0.0` |
| `MAX_UPLOAD_MB` | 否 | 本地附件上限 MB | `100` |
| `MAX_R2_UPLOAD_MB` | 否 | R2 附件上限 MB | `5120` |
| `TRASH_RETENTION_DAYS` | 否 | 回收站保留天数 | `30` |
| `DATA_DIR` | 否 | 数据目录（`app.db` + `uploads/`） | `./data` |
| `ENV_FILE` | 否 | `.env` 路径覆盖 | |
| `RESTART_COMMAND` | 否 | 更新完成后的重启命令 | `pm2 restart task-panel` |
| `DEPLOY_BRANCH` | 否 | 默认部署分支 | `main` |
| `R2_*` | 否 | R2 凭证；也可在设置页写入 DB | 见 `.env.example` |

账号播种只发生一次。之后改账号走面板「设置 - 登录账号」，环境变量不再覆盖已有行。

### 运行

```bash
# 开发（--watch 重启）
npm run dev

# 生产
npm start

# 测试
npm test
```

默认监听 `http://0.0.0.0:3000`。首次启动会在控制台打印默认账号。

## 开发工作流

### 代码质量工具

| 工具 | 命令 | 目的 |
|------|------|------|
| Node test runner | `npm test` | `test/*.test.js` |

仓库未配置 ESLint / Prettier / TypeScript。

### 提交前检查

1. `npm test`

当前 `main` 与 `origin/main` 同步。近期提交示例：`4982846 docs: 生成 task-panel 项目 Wiki 文档`。

### 分支策略

远程仅见 `main`。功能规格在 `.monkeycode/specs/`（例如 `2026-10-05-export-all-content`）。

## 常见任务

### 添加新 API 端点

**需修改的文件**:
1. `server.js` — 路由（多数需 `requireAuth`）
2. `src/store.js` 或对应模块 — 业务
3. `test/*.test.js` — 可单测的纯函数
4. `public/app.js` — Web 调用

**步骤**:
1. 在 `server.js` 按现有分组（auth / tasks / nodes / attachments / trash）添加路由
2. JSON 错误体保持 `{ error, message? }`

### 添加数据库列

**需修改的文件**: `src/db.js`

用 `ensureColumn(table, column, definition)` 做兼容迁移（已用于 `deleted_at`、`delete_batch`、`storage`）。不要改已存在库上的 CREATE TABLE 语句来「修复」旧库，靠 `ensureColumn`。

### 添加环境变量

1. `.env.example` 增加占位与注释
2. 读取处（`server.js` / `src/auth.js` / `src/store.js` / `src/storage.js`）使用 `process.env`
3. 更新本指南表格

### 修复 Bug

1. 能抽成纯函数的逻辑放 `src/`，用 `node:test` 复现（参考 `test/auth.test.js` 用临时 `DATA_DIR`）
2. 鉴权测试通过设置 `process.env.DATA_DIR` 后再 `require('../src/auth')`
3. 最小改动修复后再跑 `npm test`

### 导出格式变更

`src/export.js` 中 `SCHEMA_VERSION` 当前为 `1`。改 ZIP 结构时同步 `test/export.test.js`。

## 编码规范

### 文件组织

- 后端：`server.js` 只做 HTTP；领域在 `src/*.js`，CommonJS `module.exports`
- 前端：单文件 `public/app.js`，DOM 引用集中在 `el`

### 命名

| 类型 | 约定 | 示例 |
|------|------|------|
| Node 文件 | kebab 无，短名 | `store.js`、`auth.js` |
| 函数 | camelCase | `listTasks`、`extractToken` |
| SQL 列 | snake_case | `sort_order`、`deleted_at` |
| HTTP error | snake_case 字符串 | `bad_credentials` |

### 错误处理

路由返回 JSON `{ error, message }`，HTTP 状态 400/401/404/409/410/429/500/502。`store` 找不到资源返回 `null`，由路由映射 404。`auth.changeAccount` 抛带 `err.code` 的 Error。

Multer 错误由 `server.js` 末尾统一中间件处理。

### 安全

- 密码：scrypt + 随机 salt，`timingSafeEqual`
- 令牌：HMAC-SHA256，payload 含 `exp` 与版本 `v`
- 登录失败计数按 IP，5 次锁 5 分钟
- `app.disable('x-powered-by')`
- 附件响应 `X-Content-Type-Options: nosniff`
- 文档与示例中不要写入真实 R2 密钥；设置接口也不回传 `secretAccessKey`

### 测试

- 后端：`test/<name>.test.js`，`node:test` + `node:assert/strict`
- 鉴权测试自建临时 `DATA_DIR`
