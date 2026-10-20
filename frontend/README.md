# 网域 React 工作台

React + TypeScript + Vite，使用 React Router、Tailwind CSS、shadcn/ui 基础组件和 Lucide 图标。后端仍是项目根目录的 FastAPI 应用。

## 开发

需要 Node.js 22.12+ 或支持当前 Vite 的较新版本。当前环境使用 Node.js 24。

```powershell
# 在项目根目录启动后端
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8765

# 在另一个终端，从 frontend 目录启动前端
npm ci
npm run dev
```

Vite 将 `/api` 代理到 `http://127.0.0.1:8765`。生产构建由同一个 FastAPI 服务提供，因此不需要宽泛的 CORS 配置。

```powershell
npm run lint
npm run build
```

`build` 先运行 TypeScript 检查，再生成 `dist/`。从项目根目录执行 `./start.ps1 -BuildFrontend` 可以安装锁定依赖、构建并启动服务。`dist/` 和 `node_modules/` 不提交 Git。

浏览器回归在项目的 Windows Python 虚拟环境和已安装的 Edge 上运行：

```powershell
npm run build
$env:PLAYWRIGHT_CHANNEL = 'msedge'
npm run test:e2e
```

测试自动启动 8766 端口的独立后端，使用临时 SQLite 和明确的模型测试替身，不调用外部模型，也不修改演示库。未设置浏览器通道时使用 Playwright Chromium，需要先安装对应浏览器。当前测试服务启动路径针对 Windows。

## 模块

| 路径 | 职责 |
| --- | --- |
| `src/App.tsx` | 页面路由、侧栏、案例选择和全局提示 |
| `src/pages/assistant.tsx` | 聊天、查询轨迹和资料引用 |
| `src/pages/devices.tsx` | 搜索、筛选、分页、设备详情和排查入口 |
| `src/pages/tickets.tsx` | 当前会话工单列表和持久化详情 |
| `src/components/draft-card.tsx` | 编辑、取消和两步确认草稿 |
| `src/components/ui/` | 从 shadcn/ui 官方 registry 引入的基础组件 |
| `src/lib/types.ts` | 与当前 HTTP 响应对应的 TypeScript 数据类型 |
| `src/lib/api.ts` | JSON 请求、参数编码和 HTTP 错误处理 |
| `src/lib/workspace.tsx` | 会话初始化、消息、草稿和写操作状态 |
| `src/hooks/use-resource.ts` | 页面读取请求的取消、加载、错误和重试 |

浏览器只用 localStorage 保存会话 ID。对话和草稿从后端恢复。类型定义用于开发时检查，业务规则仍由后端校验。

当前采用完整 JSON 响应。页面中的等待提示不表示已实现模型流式输出或 SSE。模型回复以 React 文本节点渲染，仅支持加粗和行内代码；来源链接仅接受 HTTP/HTTPS。

## 演示路径

1. 选择 AP 离线案例并新建会话。
2. 进入设备资产，搜索 `S01-AP04`，查看模拟离线状态和连接关系。
3. 点击“围绕此设备排查”，检查预填的问题后发送。
4. 告诉助手实际故障现象、影响范围和已经确认做过的检查，明确要求整理工单草稿。
5. 修改草稿摘要，保存修改，再确认提交。
6. 跳转工单详情，刷新后核对工单仍可查询；在列表中检查仅有一份正式记录。

原生前端保留在 `/legacy` 作为历史版本对照。原始设备/资料演示边界见根目录 README。
