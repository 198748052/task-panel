# task-panel 文档

自托管任务看板（Express + SQLite + 静态 Web）的项目文档。面向阅读源码、对接 `/api` 或继续开发的贡献者。

**快速链接**: [架构](./ARCHITECTURE.md) | [接口](./INTERFACES.md) | [开发者指南](./DEVELOPER_GUIDE.md)

---

## 核心文档

### [架构](./ARCHITECTURE.md)

系统设计、技术栈、目录职责、子系统与数据流。

### [接口](./INTERFACES.md)

REST 端点、鉴权（Cookie / Bearer）、请求响应与导出 ZIP 格式。

### [开发者指南](./DEVELOPER_GUIDE.md)

Node 22.5+ 环境、环境变量、运行测试、扩展 API 与 SQLite 列迁移。

---

## 模块

| 模块 | 描述 | README |
|------|------|--------|
| `src/` | 领域：DB、store、auth、R2、导出、更新 | [src](./模块/src.md) |
| `public/` | 无构建 Web 客户端 | [public](./模块/public.md) |
| `server.js` | HTTP 入口与全部路由 | 见架构「HTTP API 层」 |
| `test/` | `node --test` | 见开发者指南 |

---

## 核心概念

| 概念 | 描述 |
|------|------|
| [任务](./专有概念/任务.md) | 看板卡片，根实体 |
| [节点](./专有概念/节点.md) | 任务内可勾选项 |
| [附件](./专有概念/附件.md) | 本地或 R2 文件 |
| [回收站批次](./专有概念/回收站批次.md) | `delete_batch` 软删分组 |
| [会话令牌](./专有概念/会话令牌.md) | HMAC 会话令牌 |

---

## 入门指南

### 项目新人？

1. **[架构](./ARCHITECTURE.md)** — 全局
2. **[核心概念](#核心概念)** — 领域词
3. **[开发者指南](./DEVELOPER_GUIDE.md)** — 跑起来
4. **[接口](./INTERFACES.md)** — `/api`

### 需要集成？

1. **[接口](./INTERFACES.md)** — 登录拿 `token`，之后 Cookie 或 Bearer
2. `GET /api/sync` 可一次性拉取任务树与回收站

### 首次贡献？

1. 改动后跑 `npm test`
2. 新列用 `src/db.js` 的 `ensureColumn`

---

## 快速参考

### 命令

```bash
npm install
cp .env.example .env
npm run dev
npm start
npm test
```

### 重要文件

| 文件 | 目的 |
|------|------|
| `server.js` | HTTP 入口 |
| `src/store.js` | 任务领域 |
| `src/auth.js` | 鉴权 |
| `public/app.js` | Web UI |
| `.env.example` | 环境变量模板 |
| `package.json` | 脚本与依赖（主版本 1.0.1） |
