# Requirements Document

## Introduction

为任务面板增加「导出全部内容」能力：用户在设置弹窗中点击按钮，系统将全部任务（含已归档）及其节点、节点内容与附件打包为一个 ZIP 文件下载。ZIP 内包含结构化数据 `data.json`、按任务生成的可读 `markdown/` 文档，以及本地附件的原始文件 `attachments/`。存放在 Cloudflare R2 的附件以公开 URL 记录。

## Glossary

- **System**: 任务面板应用，包含 Express 服务端与浏览器前端。
- **Export_Package**: 系统生成的 ZIP 文件，作为「全部内容导出」的产物。
- **Task**: 任务，数据库中 `tasks` 表记录，未被移入回收站的条目。
- **Node**: 任务下的节点，数据库中 `nodes` 表记录，包含标题与内容。
- **Attachment**: 节点下的附件，数据库中 `attachments` 表记录。
- **Local_Attachment**: `storage` 为 `local` 的附件，文件保存在 `data/uploads` 目录。
- **R2_Attachment**: `storage` 为 `r2` 的附件，通过公开 URL 访问。
- **Manifest**: 导出包内的 `manifest.json`，记录导出元信息与处理警告。
- **Settings_Modal**: 浏览器界面中的设置弹窗。

## Requirements

### Requirement 1

**User Story:** AS 面板用户, I want 在设置弹窗中一键导出全部内容, so that 我能完整备份任务与附件数据。

#### Acceptance Criteria

1. WHEN 用户在 Settings_Modal 中点击「导出全部内容」按钮, THE System SHALL 向服务端发起导出请求并以浏览器下载方式返回 Export_Package。
2. WHILE 导出请求进行中, THE System SHALL 在 Settings_Modal 内显示进行中状态并禁用「导出全部内容」按钮。
3. IF 导出请求失败, THE System SHALL 在 Settings_Modal 内显示错误信息并恢复「导出全部内容」按钮为可用状态。
4. WHEN 导出成功并开始下载, THE System SHALL 向用户显示成功提示。

### Requirement 2

**User Story:** AS 面板用户, I want 导出全部任务而不仅是当前筛选结果, so that 数据备份完整。

#### Acceptance Criteria

1. THE System SHALL 导出所有 `deleted_at` 为空的任务。
2. THE System SHALL 导出每个任务下的所有 `deleted_at` 为空的节点及节点内容。
3. THE System SHALL 导出已归档任务。
4. THE System SHALL 仅导出 `deleted_at` 为空的任务、节点与附件。

### Requirement 3

**User Story:** AS 面板用户, I want 导出包结构清晰, so that 我既能程序化处理也能直接阅读。

#### Acceptance Criteria

1. WHEN 导出完成, THE System SHALL 生成包含 `manifest.json`、`data.json`、`markdown/` 与 `attachments/` 的 Export_Package。
2. THE System SHALL 在 `data.json` 中包含 `schemaVersion`、`exportedAt`、任务 `tasks` 数组及其节点与附件。
3. THE System SHALL 在 Manifest 中记录导出时间、schema 版本与各类型条目数量。
4. THE System SHALL 对 Markdown 与附件文件名进行安全化处理，移除路径分隔符与控制字符。
5. WHEN 多个附件或任务产生同名文件, THE System SHALL 通过序号前缀保证 Export_Package 内名称唯一。

### Requirement 4

**User Story:** AS 面板用户, I want 附件被正确收录, so that 导出的备份可用于恢复。

#### Acceptance Criteria

1. THE System SHALL 将每个 Local_Attachment 的文件内容写入 `attachments/`，并在 `data.json` 中记录其在 Export_Package 内的相对路径。
2. THE System SHALL 在 `data.json` 中为每个 R2_Attachment 记录公开 URL。
3. IF 某个 Local_Attachment 的文件在磁盘上不存在, THE System SHALL 跳过该文件并在 Manifest 中记录警告。
4. THE System SHALL 在 Manifest 中记录成功打包的附件文件数量。

### Requirement 5

**User Story:** AS 面板用户, I want 可读的 Markdown 文档, so that 我能直接浏览任务内容。

#### Acceptance Criteria

1. THE System SHALL 为每个任务生成一个 Markdown 文件，包含任务标题、描述、颜色、归档状态与时间信息。
2. THE System SHALL 在任务 Markdown 中按顺序列出节点标题与节点内容。
3. THE System SHALL 在节点下以列表形式列出附件，Local_Attachment 引用 Export_Package 内相对路径，R2_Attachment 引用公开 URL。
4. THE System SHALL 在 `markdown/` 中为每个任务生成文件名唯一且与原任务标题相对应的 Markdown 文件。

### Requirement 6

**User Story:** AS 面板所有者, I want 导出受登录保护, so that 数据不会被未授权访问。

#### Acceptance Criteria

1. WHILE 用户未通过登录校验, THE System SHALL 拒绝导出请求并返回未授权状态。
2. THE System SHALL 通过服务端接口在响应流中生成 Export_Package，避免向客户端暴露服务端文件系统路径。

### Requirement 7

**User Story:** AS 面板用户, I want 在无内容时得到明确反馈, so that 我不会得到空文件。

#### Acceptance Criteria

1. IF 系统中不存在任何未被删除的任务, THE System SHALL 返回提示信息且不生成 Export_Package。
2. WHEN 导出失败且响应尚未开始时, THE System SHALL 返回 JSON 格式的错误信息。
