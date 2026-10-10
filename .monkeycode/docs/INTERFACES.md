# 接口文档

task-panel 的公开契约是 `server.js` 中的 REST JSON API。Web 通过 Cookie `tb_session` 鉴权；Android 使用同一枚令牌，请求头 `Authorization: Bearer <token>`。`src/auth.extractToken` 优先 Cookie，再读 Bearer。

未登录访问受保护接口返回 `401 {"error":"unauthorized"}`。登录连续失败 5 次后该 IP 锁定 5 分钟，返回 `429 {"error":"too_many_attempts"}`。

会话 TTL：`SESSION_TTL_MS` = 30 天。改密会更新 `sessionVersion()`（密码哈希前 16 位），旧令牌立即失效；`PUT /api/account` 会签发新令牌。

## 认证方式

| 客户端 | 方式 |
|--------|------|
| Web | `Set-Cookie: tb_session=<token>; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000000` |
| Android | 登录响应当中的 `token`，后续 `Authorization: Bearer <token>` |

`GET /api/session` 与 `POST /api/login`、`POST /api/logout` 不要求已登录。其余 `/api/*` 均走 `requireAuth`。

---

## 会话与账号

### GET /api/session

无需登录。返回当前会话与运行时上限。

**响应**
```json
{
  "authEnabled": true,
  "authed": false,
  "maxUploadMb": 100,
  "maxR2UploadMb": 5120,
  "retentionDays": 30,
  "r2Enabled": false,
  "deployedDir": "/path/to/app"
}
```

### POST /api/login

**请求** `{ "username": "admin", "password": "..." }`

**成功 200** `{ "ok": true, "token": "<hmac>", "expiresInMs": 2592000000 }`，并设置 Cookie。

**失败** `401 bad_credentials`；锁定时 `429 too_many_attempts`。

### POST /api/logout

清除 Cookie，返回 `{ "ok": true }`。不吊销令牌本身；Web 端清 Cookie 即退出。

### GET /api/account

**响应** `{ "username": "admin" }`

### PUT /api/account

**请求** `{ "username", "currentPassword", "newPassword" }`

`newPassword` 可空（只改用户名）。新密码最短 6 位。

**成功** `{ "ok": true, "username", "token", "expiresInMs" }`

**失败 400** `bad_password` / `username_required` / `username_too_long` / `weak_password` / `account_missing`

---

## 同步快照（移动端）

### GET /api/sync

一次返回任务树、回收站与上传限制，减少 Android 往返。

**响应**
```json
{
  "serverTime": "2026-10-10T00:00:00.000Z",
  "tasks": [],
  "trash": [],
  "retentionDays": 30,
  "maxUploadMb": 100,
  "maxR2UploadMb": 5120,
  "r2Enabled": false
}
```

`tasks` 结构与 `GET /api/tasks` 相同。

---

## 任务

任务字段：`id, title, description, color, archived, sort_order, created_at, updated_at, nodes[]`。`color` 前端使用 `blue|green|amber|rose|violet|cyan|slate`。列表排除 `deleted_at` 非空行，排序：`archived ASC, sort_order ASC, id ASC`。

### GET /api/tasks

**响应** `{ "tasks": [ TaskWithNodes ] }`

每个 node 含 `attachments[]`。附件对外字段：`id, node_id, original_name, mime_type, size, storage, url, created_at`。`storage === "r2"` 时 `url` 为公开地址，否则为 `null`。

### POST /api/tasks

**请求** `{ "title", "description?", "color?" }`

`title` 必填。**201** `{ "task": Task }`（不含 nodes 嵌套，为 `getTask` 行）。

### PATCH /api/tasks/:id

允许字段：`title, description, color, archived`。

**404** `{ "error": "not_found" }`

### DELETE /api/tasks/:id

软删除任务及其未删节点与附件，同一 `delete_batch`。

**响应** `{ "ok": true, "batch": "<uuid>" }`

### POST /api/tasks/reorder

**请求** `{ "ids": [1, 2, 3] }`，按数组下标写入 `sort_order`。

---

## 节点

节点字段：`id, task_id, title, content, done, sort_order, created_at, updated_at, attachments[]`。

新建节点的 `sort_order` 取当前任务已有节点的 `MIN(sort_order) - 1`（插到列表前部）。

### POST /api/tasks/:id/nodes

**请求** `{ "title", "content?" }`

**201** `{ "node": Node }`；任务不存在 `404 task_not_found`。

### PATCH /api/nodes/:id

允许字段：`title, content, done`。

### DELETE /api/nodes/:id

软删除节点及其附件。`{ "ok": true, "batch" }`

### POST /api/nodes/reorder

**请求** `{ "ids": [...] }`

---

## 附件

### POST /api/nodes/:id/attachments?storage=local|r2

`multipart/form-data`，字段名 `files`，最多 20 个。默认 `local`。`storage=r2` 且未配置 R2 时 `400 r2_unavailable`。

大小上限：本地 `MAX_UPLOAD_MB`（默认 100），R2 `MAX_R2_UPLOAD_MB`（默认 5120）。超限 `400`，`error` 为 multer 的 `LIMIT_FILE_SIZE`。

R2 上传流程：先落到 `UPLOAD_DIR`，再 `putObject`，然后删除临时文件。

**201** `{ "attachments": [...], "storage": "local"|"r2" }`

### GET /api/attachments/:id

流式返回文件。`?inline=1` 且 MIME 匹配 image/pdf/text/video/audio/json 时 `Content-Disposition: inline`。

本地文件缺失 `410 file_missing`；R2 未配置 `500 r2_not_configured`；R2 拉取失败 `502 r2_fetch_failed`。

### PATCH /api/attachments/:id

**请求** `{ "original_name": "新文件名" }`，最长 255。

### DELETE /api/attachments/:id

软删除。`{ "ok": true, "batch" }`

---

## 回收站

条目按 `delete_batch` 聚合：

```json
{
  "batch": "uuid",
  "type": "task|node|attachment",
  "title": "...",
  "parent": "",
  "deleted_at": "...",
  "expires_at": "...",
  "days_left": 30,
  "nodes": 0,
  "attachments": 0
}
```

### GET /api/trash

`{ "items": [...], "retentionDays": 30 }`

### POST /api/trash/:batch/restore

清除该批次及相关父级的 `deleted_at` / `delete_batch`。

### DELETE /api/trash/:batch

物理删除该批次，并删除本地文件或 R2 对象。

### POST /api/trash/empty

清空全部批次。

进程启动时执行一次 `purgeExpired`，之后每小时执行。超过 `TRASH_RETENTION_DAYS`（默认 30）的批次被彻底删除。

---

## 设置与系统

### GET /api/settings

`{ "r2": { "enabled", "values": { accountId, accessKeyId, bucket, publicBaseUrl, endpoint, region, prefix, forcePathStyle }, "hasSecret", "secretSource", "sources" } }`

密钥本体不回传，只给 `hasSecret` 与来源 `db|env|none`。页面保存的 settings 覆盖同名环境变量。

### PUT /api/settings

请求体为 R2 字段。`secretAccessKey` 空字符串表示不改；`clearSecret: true` 清空密钥。

### POST /api/settings/test

用给定配置 `HeadBucket`。失败 `400 r2_test_failed`。

### GET /api/system

```json
{
  "version": "<short sha>",
  "branch": "main",
  "git": true,
  "remote": { "url": "...", "branch": "main" },
  "update": { }
}
```

`update` 来自 `data/update-status.json`。

### PUT /api/system/remote

`{ "url", "branch" }`。非 Git 目录 `400 no_git`。

### POST /api/system/remote/test

探测远程可达性。

### POST /api/system/update

异步开始更新，**202** `{ "ok": true, "message": "已开始更新" }`。已在进行中 **409**。

---

## 导出

### GET /api/export

空看板 `400 empty`。否则 `Content-Type: application/zip`，文件名 `task-board-export-<stamp>.zip`。

ZIP 内容（`src/export.js`）：
- `data.json` — `app: "task-board"`, `schemaVersion: 1`, `exportedAt`, `counts`, `tasks`
- `manifest.json` — 计数与 warnings
- `markdown/<id>_<title>.md` — 每任务一份
- `attachments/<id>_<name>` — 仅 `storage === "local"` 且磁盘文件存在的附件；R2 附件在 JSON/Markdown 中保留 `url`

---

## Android Retrofit 对照

接口定义：`android/.../data/remote/TaskBoardApi.kt`。覆盖上表除 Web 专用的 settings/R2 配置与一键更新写入之外的读写端点。Android 使用 `GET /api/sync` 做全量拉取，不在客户端配置 R2。

DTO 见 `android/.../data/remote/dto/Dtos.kt`。

## Web 前端调用约定

`public/app.js` 的 `api(method, url, body)` 使用 `fetch` + `credentials: 'same-origin'` + `Content-Type: application/json`。附件上传用 `FormData` 字段 `files`。导出用裸 `fetch('/api/export')` 下载 blob。
