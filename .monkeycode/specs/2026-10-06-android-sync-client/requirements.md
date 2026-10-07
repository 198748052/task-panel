# Requirements Document

## Introduction

为现有「个人任务管理面板」（Express + SQLite 后端 + Web 前端）增加一个原生 Android（Kotlin）客户端。该客户端连接用户已有的公网域名，对任务、节点、附件、回收站与导出内容进行同步，使手机可以随时查看并维护面板数据。

## Glossary

- **Backend_Service**：现有任务面板服务，基于 Express 与 SQLite，暴露以 `/api` 为前缀的 HTTP JSON 接口（`server.js`）。
- **Android_Client**：本需求新增的原生 Android 应用，使用 Kotlin 编写。
- **Base_URL**：用户配置的服务公网地址（含协议，例如 `https://tasks.example.com`）。
- **Session_Token**：后端签发的会话令牌，Web 端以 Cookie（名为 `tb_session`）承载，Android_Client 以 `Authorization: Bearer` 承载，有效期 30 天（`src/auth.js`）。
- **Task**：任务卡片，字段包含标题、描述、颜色、归档状态与排序（`src/store.js`）。
- **Node**：任务下的节点，字段包含标题、内容、完成状态与排序。
- **Attachment**：节点下的附件，字段包含文件名、MIME 类型、大小与存储位置（`local` 或 `r2`）。
- **Trash_Batch**：一次删除操作产生的批次，回收站按批次恢复或彻底清除。
- **Local_Cache**：Android_Client 本地持久化的数据副本，用于离线展示。
- **Pending_Change**：Android_Client 在离线状态产生、尚未提交到 Backend_Service 的写操作。
- **Export_Archive**：后端 `GET /api/export` 返回的 zip 归档。

## Requirements

### Requirement 1: 账号认证与会话保持

**User Story:** AS 面板使用者, I want 在手机上登录并保持会话, so that 我无需重复输入账号密码即可维护数据

#### Acceptance Criteria

1. WHEN Android_Client 首次启动且 Local_Cache 中不存在有效 Session_Token, Android_Client SHALL 展示登录界面。
2. WHEN 用户提交用户名与密码, Android_Client SHALL 向 `POST /api/login` 发送凭证并在成功后保存响应返回的 Session_Token。
3. IF `POST /api/login` 返回 401, Android_Client SHALL 在登录界面展示“用户名或密码错误”提示。
4. IF `POST /api/login` 返回 429, Android_Client SHALL 展示“尝试次数过多，请稍后再试”提示。
5. WHILE Session_Token 有效, Android_Client SHALL 在每个 `/api` 请求中以 `Authorization: Bearer` 携带该令牌。
6. WHEN 任一 `/api` 请求返回 401, Android_Client SHALL 清除本地 Session_Token 并跳转登录界面。
7. WHEN 用户触发退出登录, Android_Client SHALL 调用 `POST /api/logout` 并清除本地 Session_Token 与本地缓存。

### Requirement 2: 任务数据同步

**User Story:** AS 面板使用者, I want 在手机上查看与维护任务卡片, so that 我可以随时调整任务

#### Acceptance Criteria

1. WHEN 用户进入任务列表或触发下拉刷新, Android_Client SHALL 调用 `GET /api/tasks` 拉取全部未删除任务及其节点与附件元数据。
2. WHEN `GET /api/tasks` 返回成功, Android_Client SHALL 用响应数据覆盖 Local_Cache 中对应的任务、节点与附件元数据。
3. WHEN 用户创建任务, Android_Client SHALL 调用 `POST /api/tasks` 并携带标题、描述与颜色。
4. WHEN 用户修改任务标题、描述、颜色或归档状态, Android_Client SHALL 调用 `PATCH /api/tasks/:id` 并携带被修改字段。
5. WHEN 用户删除任务, Android_Client SHALL 调用 `DELETE /api/tasks/:id` 并记录返回的 Trash_Batch。
6. WHEN 用户调整任务顺序, Android_Client SHALL 调用 `POST /api/tasks/reorder` 并携带按新顺序排列的任务 id 列表。

### Requirement 3: 节点数据同步

**User Story:** AS 面板使用者, I want 在手机上维护任务节点, so that 我可以逐项推进任务

#### Acceptance Criteria

1. WHEN 用户打开某个任务, Android_Client SHALL 展示该任务的节点列表及每个节点的完成状态。
2. WHEN 用户创建节点, Android_Client SHALL 调用 `POST /api/tasks/:id/nodes` 并携带节点标题与内容。
3. WHEN 用户修改节点标题、内容或完成状态, Android_Client SHALL 调用 `PATCH /api/nodes/:id` 并携带被修改字段。
4. WHEN 用户删除节点, Android_Client SHALL 调用 `DELETE /api/nodes/:id` 并记录返回的 Trash_Batch。
5. WHEN 用户调整节点顺序, Android_Client SHALL 调用 `POST /api/nodes/reorder` 并携带按新顺序排列的节点 id 列表。

### Requirement 4: 附件同步

**User Story:** AS 面板使用者, I want 在手机上查看与上传附件, so that 任务资料随任务一起可用

#### Acceptance Criteria

1. WHEN 用户打开某个节点, Android_Client SHALL 展示该节点的附件列表，包含文件名、大小与存储位置。
2. WHEN 用户点击某个附件, Android_Client SHALL 通过 `GET /api/attachments/:id` 下载该附件并交由系统应用打开或保存。
3. WHEN 用户从手机选择文件并确认上传, Android_Client SHALL 以 multipart 形式调用 `POST /api/nodes/:id/attachments` 并携带选中文件。
4. WHEN 用户上传前选择存储目标, Android_Client SHALL 通过 `storage` 查询参数传入 `local` 或 `r2`。
5. IF Backend_Service 未配置 Cloudflare R2, Android_Client SHALL 仅提供 `local` 存储目标。
6. WHEN 用户重命名附件, Android_Client SHALL 调用 `PATCH /api/attachments/:id` 并携带新的文件名。
7. WHEN 用户删除附件, Android_Client SHALL 调用 `DELETE /api/attachments/:id` 并记录返回的 Trash_Batch。
8. IF 上传文件超过 Backend_Service 返回的大小上限, Android_Client SHALL 在本地拦截并提示超限。

### Requirement 5: 回收站同步

**User Story:** AS 面板使用者, I want 在手机上管理回收站, so that 我可以恢复误删内容

#### Acceptance Criteria

1. WHEN 用户打开回收站, Android_Client SHALL 调用 `GET /api/trash` 并展示批次列表，包含类型、标题、所属父级与剩余保留天数。
2. WHEN 用户恢复某个批次, Android_Client SHALL 调用 `POST /api/trash/:batch/restore`。
3. WHEN 用户彻底删除某个批次, Android_Client SHALL 调用 `DELETE /api/trash/:batch`。
4. WHEN 用户清空回收站, Android_Client SHALL 调用 `POST /api/trash/empty`。
5. IF 恢复或彻底删除接口返回 404, Android_Client SHALL 刷新回收站列表并提示该批次已失效。

### Requirement 6: 内容导出

**User Story:** AS 面板使用者, I want 在手机上获取完整导出包, so that 我可以备份或迁移数据

#### Acceptance Criteria

1. WHEN 用户触发导出, Android_Client SHALL 请求 `GET /api/export` 并将响应以 zip 文件保存到设备下载目录。
2. IF `GET /api/export` 返回 400, Android_Client SHALL 提示“没有可导出的内容”。
3. WHEN 导出文件下载完成, Android_Client SHALL 通过系统通知或界面提示告知保存路径。

### Requirement 7: 离线缓存与一致性

**User Story:** AS 面板使用者, I want 在无网络时仍能查看数据并在联网后完成同步, so that 通勤等弱网场景不中断使用

#### Acceptance Criteria

1. WHILE 设备无网络连接, Android_Client SHALL 使用 Local_Cache 展示最近一次成功同步的数据。
2. WHILE 设备无网络连接, Android_Client SHALL 接受用户对任务与节点的增删改操作并记录为 Pending_Change。
3. WHEN 网络恢复, Android_Client SHALL 按记录顺序提交 Pending_Change 并刷新 Local_Cache。
4. IF 写操作返回 404, Android_Client SHALL 移除对应的 Local_Cache 记录并提示该对象已不存在。
5. IF 写操作返回 401, Android_Client SHALL 保留 Pending_Change 并跳转登录界面。
6. WHEN 拉取到的任务或节点 `updated_at` 晚于 Local_Cache 记录, Android_Client SHALL 采用服务端版本覆盖本地版本。

### Requirement 8: 设置与系统信息

**User Story:** AS 面板使用者, I want 在手机上查看服务状态并维护账号, so that 我可以完成基本运维

#### Acceptance Criteria

1. WHEN 用户打开设置页, Android_Client SHALL 调用 `GET /api/session` 与 `GET /api/system` 并展示服务版本、分支、R2 配置状态与附件大小上限。
2. WHEN 用户修改用户名或密码, Android_Client SHALL 调用 `PUT /api/account` 并携带当前密码与新值。
3. WHEN Android_Client 首次使用且 Base_URL 为空, Android_Client SHALL 要求用户先填写 Base_URL 并执行连通性校验。
4. IF Base_URL 连通性校验失败, Android_Client SHALL 提示用户检查地址与网络。

### Requirement 9: 安全与传输

**User Story:** AS 面板使用者, I want 凭证与传输受保护, so that 我的数据不被泄露

#### Acceptance Criteria

1. WHEN Android_Client 持久化 Session_Token, Android_Client SHALL 使用 Android 加密存储保存该凭证。
2. WHEN Base_URL 使用明文 HTTP, Android_Client SHALL 在设置页提示存在安全风险。
3. WHILE 传输附件或导出文件, Android_Client SHALL 复用已保存的 Session_Token 并将响应写入应用私有目录或用户选择的目录。
