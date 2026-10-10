# android/

原生 Kotlin 客户端，包名 `com.taskboard.sync`，applicationId 相同。minSdk 26，compileSdk/targetSdk 34，versionName `1.0.2` / versionCode 3。Release 开启 R8 minify + shrinkResources。

## 结构

```
android/app/src/main/java/com/taskboard/sync/
├── TaskBoardApp.kt / MainActivity.kt
├── di/AppContainer.kt
├── data/remote/     TaskBoardApi、DTO、AuthInterceptor、TokenStore、ApiHolder
├── data/local/      AppDatabase、Entities、Daos、Relations
├── data/repository/ Task / Session / Attachment / Trash / Export
├── data/sync/       PendingChangeSyncer、SyncWorker、SyncScheduler、Payloads
└── ui/              AppNav、login、tasks、detail、trash、settings、theme
```

## 关键文件

| 文件 | 目的 |
|------|------|
| `TaskBoardApi.kt` | Retrofit 契约，与后端路径一致 |
| `PendingChangeSyncer.kt` | FIFO 提交离线变更；401 抛出，NETWORK 中断，NOT_FOUND 丢本地 |
| `Entities.kt` | Room：`localId` 为客户端主键，`remoteId` 绑定服务端 |
| `AppNav.kt` | 路由：login / tasks / detail / trash / settings |
| `AppContainer.kt` | 手写 DI；OkHttp 超时 connect 20s / read 60s / write 120s |

## 依赖

**本模块依赖**:
- 后端 `/api`（Bearer 令牌）
- Jetpack Compose BOM 2024.06.00、Room、Retrofit、WorkManager

**依赖本模块的**:
- 无

## 规范

### 离线范围

仅任务与节点（含重排）进入 `pending_changes`。附件上传下载、回收站、导出、账号修改要求在线。

### 同步

1. UI 写 Room + 入队
2. WorkManager / 手动刷新调用 `flush`
3. 成功后 `bindRemoteId` 并删队列项
4. `GET /api/sync` 覆盖缓存，保留 `dirty` 行

父任务未同步时子节点 `CREATE_NODE` 抛 `DependencyMissingException`，整次 flush 停止待重试。

### 测试

`android/app/src/test/`：`ApiHolderTest`、`ApiContractTest`、`TimeFormatTest`、`FileUtilTest`。

```bash
cd android
./gradlew :app:testDebugUnitTest
./gradlew :app:assembleDebug
```

产物：`android/app/build/outputs/apk/debug/app-debug.apk`。

## 添加新文件

1. 新 API：先改 `TaskBoardApi` 与 `Dtos.kt`，再仓储
2. 离线写操作：扩展 `PendingChangeType` 与 `PendingChangeSyncer.apply`
3. 新页面：`ui/` + `AppNav.kt` 注册路由
