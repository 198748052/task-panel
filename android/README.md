# 任务面板 Android 客户端

原生 Kotlin 客户端，连接自建任务面板后端的 `/api` 接口，支持任务/节点离线编辑、附件下载与上传、回收站管理与内容导出。

## 环境要求

- JDK 17
- Android SDK（编译 SDK 34、Build Tools 34）
- Android Studio Ladybug 或更高版本，或本地 Gradle 8.7+

工程已包含 Gradle Wrapper（`gradlew` / `gradle/wrapper/`），首次构建会自动下载 Gradle 8.7。构建前需在 `android/local.properties` 指定 SDK 路径（该文件已被 gitignore）：

```properties
sdk.dir=/path/to/Android/sdk
```

## 构建

```bash
cd android

# 运行 JVM 单元测试
./gradlew :app:testDebugUnitTest

# 构建调试 APK
./gradlew :app:assembleDebug
```

产物位于 `android/app/build/outputs/apk/debug/app-debug.apk`。

当前工程已在 JDK 17 + Android SDK 34 + Gradle 8.7 环境下完成一次完整构建：单元测试 9 项全部通过，并成功产出 `app-debug.apk`。

## 首次使用

1. 安装并打开应用。
2. 在登录页填写后端公网地址（例如 `https://tasks.example.com`）、用户名与密码。
3. 登录成功后进入任务列表，下拉或点击刷新进行同步。

## 与后端接口的关系

- 鉴权使用 `POST /api/login` 返回的签名令牌，通过 `Authorization: Bearer <token>` 携带。
- `GET /api/sync` 一次性返回任务树、回收站与上传限制，减少移动端往返。
- 离线编辑仅覆盖任务与节点；附件上传、回收站与导出为在线操作。
- 服务地址若为明文 `http://`，登录页会给出安全提示。

## 模块结构

```
app/src/main/java/com/taskboard/sync/
  data/remote/       Retrofit 接口、DTO、Bearer 拦截器、令牌存储、错误映射
  data/local/        Room 实体、DAO、数据库、关系模型
  data/repository/   任务/会话/附件/回收站/导出仓储
  data/sync/         离线变更队列同步器、WorkManager Worker 与调度
  di/                手写依赖容器
  ui/                Compose 页面与 ViewModel
```
