# public/

无构建步骤的 Web SPA。Express `express.static` 托管，非 `/api/` 路径回退 `index.html`。

## 结构

```
public/
├── index.html     # 登录、看板、抽屉、设置/回收站/更新/预览模态
├── app.js         # 全部前端逻辑
└── styles.css     # 主题与布局
```

## 关键文件

| 文件 | 目的 |
|------|------|
| `index.html` | 结构：`#login-view`、`#app-view`、节点抽屉、任务详情、各 modal |
| `app.js` | `state`、`api()`、看板渲染、拖拽排序、附件上传进度、设置页 |
| `styles.css` | 颜色 token 与卡片布局 |

`app.js` 中 `COLORS`：`blue, green, amber, rose, violet, cyan, slate`。节点列表超过 `COLLAPSE_LIMIT = 5` 会折叠。

## 依赖

**本模块依赖**:
- 浏览器 `fetch`，`credentials: 'same-origin'`
- 后端 `/api`

**依赖本模块的**:
- `server.js` 静态中间件

## 规范

- 无框架、无打包；改完刷新即可
- DOM 查询集中在 `el`
- HTML 插入走 `escapeHtml`
- 附件上传 `FormData` 字段名必须为 `files`，query `storage=local|r2`

## 添加新文件

静态资源直接放 `public/` 即可被托管。新页面状态优先扩 `index.html` + `app.js`，保持单页。
