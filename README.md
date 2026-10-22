# 网域 · 多站点网络运维助手

面向通信工程 / AI 应用工程学习的本地演示项目。用户可以按位置或设备编号查资产、查模拟状态，按需检索官方资料，并在明确确认后保存本地工单。

阅读代码时先看 [目录与模块清单](docs/目录与模块清单.md)：逐项说明文件用途、生成数据、工具职责与主要调用路径。

技术栈：React、TypeScript、Vite、React Router、Tailwind CSS、shadcn/ui；Python 3.11、FastAPI、LangChain、LangGraph、Milvus、SQLite。

React 工作台包含运维助手、设备资产、工单中心和历史记录四个页面。设备详情可以带设备编号进入排查对话；工单草稿经编辑、保存和明确确认后进入工单详情。历史记录支持按对话内容或设备编号搜索、打开旧会话继续排查，以及查看该会话的关联工单。改造过程和验证边界见 [全栈改造记录](docs/全栈改造记录.md)，前端模块说明见 [frontend/README.md](frontend/README.md)。

**演示边界：** 10 个虚构站点、140 台模拟设备、4 个预设状态案例。没有连接真实网络设备、监控系统或企业工单平台；不会远程修改配置或自动通知运维人员。

## 运行

需要 Python 3.11、Node.js（当前验证使用 24）、Docker 的 Linux 容器环境、支持工具调用的 Chat Completions 兼容模型服务，以及本地 Embedding 模型。以下命令从本项目根目录运行。

首次安装主程序（PowerShell）：

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
```

如果未安装 Windows Python 启动器，可将 `py -3.11` 替换为你自己的 Python 3.11 可执行文件路径。

填写 `.env`：`OPENAI_API_KEY`、`OPENAI_API_BASE`、`MODEL_NAME` 是对话服务配置；`EMBEDDING_PYTHON` 指向安装了 `sentence-transformers` 和 CPU PyTorch 的 Python 环境，`EMBEDDING_MODEL` 指向已下载的 `paraphrase-multilingual-MiniLM-L12-v2` 本地目录。可复用自己的现有环境，也可另建独立环境。Embedding 工作进程启用离线模式，运行时不会自动下载模型。

`CREDENTIALS_FILE` 可选，用于只读引用已有本地凭据文件；未使用时留空。`.env`、数据库、模型缓存及运行日志均不提交到 Git。

首次启动与知识入库：

```powershell
docker --context desktop-linux compose -f compose.yaml up -d
.\.venv\Scripts\python.exe scripts\seed_data.py
.\.venv\Scripts\python.exe scripts\fetch_docs.py
.\.venv\Scripts\python.exe scripts\ingest_docs.py
.\start.ps1 -BuildFrontend
```

`-BuildFrontend` 会按 `frontend/package-lock.json` 安装前端依赖并构建。首次安装或前端源码更新后使用它；已有当前构建时直接运行 `.\start.ps1`。网页：<http://127.0.0.1:8765>。启动脚本以前台方式运行，Ctrl+C 停止后端。

前端开发可在另一个终端运行 `npm --prefix frontend run dev`，其 `/api` 请求代理到 8765 端口。构建产物由 FastAPI 同源提供，设备和工单详情链接支持直接打开与刷新。原生页面保留在 `/legacy` 作历史对照。

已入库且未修改文档时不必重复入库。

`desktop-linux` 是 Docker Desktop 的本地 context；其他环境请使用自己的 Linux 容器 context。运行入库前，应等待 Milvus 健康接口 `http://127.0.0.1:9091/healthz` 返回成功。

## 配置与部署选择

- 主程序独立 Python 3.11 虚拟环境，依赖以 `requirements.txt` 为准。
- 对话模型通过 LangChain `ChatOpenAI` 调用兼容 Chat Completions 的接口；支持真实工具调用及结果回传。
- LangGraph 使用模型节点 / 工具节点循环，工具白名单与每轮预算由程序控制；会话检查点写入独立 SQLite。
- Milvus Standalone 3.0.1，Compose 以官方发布文件为基础，独立命名卷，仅本机开放 19530/9091。三个容器内存上限合计 6 GiB；这不是性能测评或最低配置结论。
- Embedding 为已缓存的 `paraphrase-multilingual-MiniLM-L12-v2`，384 维、CPU、归一化向量。为避免修改旧环境或重复安装大体积 PyTorch，主程序通过 JSON-lines 子进程协议调用 `EMBEDDING_PYTHON`。这意味着运行依赖该只读外部环境，不能说整个项目完全自包含。
- Embedding 子进程不下载模型、不接收密钥；配置改为其他模型后需要重新构建对应集合，不能混用维度与向量空间。
- 单后端进程、同会话串行；不适用于未加认证的公网部署。

## 数据与资料

SQL 保存站点、资产、设备连接关系、模拟状态、会话、草稿、正式工单。模型通过固定参数工具查询，不执行自由生成的 SQL。

Milvus 只存知识片段和来源。语义检索与设备类型、型号适用范围过滤结合；未知产品型号不套用当前厂商资料。当前官方资料是 Omada 系列排障 FAQ，没有对特定固件版本的菜单、命令和功能做覆盖承诺。

资料入口：

- `data/source_manifest.json`：来源 URL、抓取时间、内容哈希、适用范围。
- `data/docs/`：提取的官方正文，以及明确标注的自建演示 SOP。
- `data/raw/`：本机下载原始 HTML，不提交到 Git。
- `data/chunks.json`：实际片段及来源。
- `data/runtime/index.json`：本次索引规模与 Embedding 信息，**不是 Milvus 实时健康状态**。

官方文档版权归原作者；本地资料用于本项目检索和核对。来源清单与下载脚本保留原始出处。

公开仓库保留来源清单、抓取与入库脚本，以及自建演示 SOP；官方正文、生成的片段文件和含检索正文的原始验证输出留在本地。首次克隆后，先运行 `fetch_docs.py` 再入库。

重新获取与索引：

```powershell
.\.venv\Scripts\python.exe scripts\fetch_docs.py
.\.venv\Scripts\python.exe scripts\ingest_docs.py
```

抓取脚本优先复用本地原始缓存；刷新来源时先保留旧副本，再更新相应缓存。脚本报告失败资料，不静默伪造成功。入库脚本只同步项目专用集合中的片段，不触碰其他集合。

## 演示顺序

1. 新建会话，选择“杭州仓库 · 仓储区 AP 离线”。
2. 问“杭州仓库有哪些 AP？”：应查询 SQL，无需 RAG。
3. 问“S01-AP04 在线吗？”：应显示模拟 offline 状态和记录时间。
4. 问“杭州仓库的仓储区 Wi-Fi 掉线，怎么排查？”：应结合设备线索与资料，说明未知根因。
5. 反馈“仍未恢复，帮我整理报障工单”：出现草稿，尚未创建正式记录。
6. 修改草稿后保存修改，再点击“确认提交”：返回正式工单编号。
7. 问“查询工单 T-…”，或刷新页面查看已保存记录。
8. 另开 normal 案例会话，同一设备状态不同；会话案例相互隔离。
9. 打开“历史记录”，搜索设备编号或之前描述的现象，点击“打开对话”恢复旧会话，或点击“查看工单”查看该会话的正式记录。

历史列表显示当前本机演示数据库中的会话，按消息、草稿、工单的最近活动时间排序，每页 12 条。标题取第一条用户消息，摘要取最近一条消息；搜索覆盖完整对话正文。浏览列表不会改变当前会话，打开后才恢复对应案例、已保存草稿和模型会话上下文。此前保存的记录可直接使用；它不是多用户身份隔离的历史管理，也不会根据建议或工单自动推断故障已解决。

## 主要文件与调用路径

```text
React frontend/src/ → app/main.py → app/graph.py
                               ├─ app/tools.py → app/db.py → SQLite
                               ├─ app/rag.py → Embedding 子进程 + Milvus
                               └─ app/tickets.py → 草稿
React 明确确认 → app/main.py → app/tickets.py → SQLite 事务 → 正式工单
设备页 → 会话设备列表/详情 API → SQLite 场景快照与关系
工单页 → 会话工单列表/详情 API → SQLite 已确认工单
scripts/fetch_docs.py → 本地正文 → scripts/ingest_docs.py → Milvus
```

工单创建函数不暴露为模型工具。确认接口检查会话、草稿版本和状态，事务内创建工单并更新草稿；同一草稿重复确认返回既有编号。修改后确认旧版本、取消后确认均冲突。浏览器存储的会话标识用于本地演示访问，不等同于生产身份认证。

首版与早期架构稿的差异：使用受限的模型工具循环，而非逐个手写意图分类节点；分页采用 offset；草稿/工单主体采用经 Pydantic 校验的 JSON 快照，设备关联仍使用外键表；等待用户时结束 HTTP 请求，下一轮加载检查点。没有宣称验证了 LangGraph interrupt/resume。

## 验证

```powershell
.\.venv\Scripts\python.exe -m pytest -q
npm --prefix frontend run lint
npm --prefix frontend run build
```

自动化测试使用独立临时业务数据库。模型故障与工具回传的部分单元测试使用明确的测试替身，不能代替真实模型 / Milvus 验证。实际外部调用、网页核对和剩余限制见 `docs/验证记录.md`。

React 的浏览器回归启动独立测试后端，使用真实 HTTP 和 SQLite，模型使用明确的测试替身。执行方式及本次结果见 `docs/全栈改造记录.md`。当前聊天继续返回完整 JSON，尚未实现 SSE 或逐 token 输出。

2026-10-20 React 改造：Python `18 passed`；前端 lint、TypeScript/Vite 构建通过；Edge 浏览器回归 `3 passed`。另在真实页面中通过现有模型配置完成“设备查询 → 草稿编辑 → 明确确认 → 工单刷新恢复”，生成本地演示工单 `T-0B83A3858F04`。本次没有重跑 Milvus 检索质量评估，详细范围见改造记录。

历史记录，2026-10-02 上传前重新运行：`14 passed, 1 warning`；`pip check` 返回 `No broken requirements found`。当时未重新执行真实模型、Milvus 或浏览器完整流程，相关记录属于 2026-09-13 的历史验证。

同日另将 Git 已提交源码导出到临时目录，不携带 `.env`、数据库、官方正文、片段或运行缓存，复用现有项目虚拟环境运行测试，结果为 `14 passed, 1 warning`。这验证了现有测试不依赖未提交的本机数据，不等同于在全新机器上从零安装依赖成功。

## 后续扩展边界

可替换设备工具背后的数据源接入监控，补充明确型号版本资料、检索评估和真实故障历史。当前没有实现或验证：生产认证、远程设备控制、自动通知、规模性能测试、复杂前端拓扑、所有通信设备知识覆盖。

## 参考

- [Milvus 官方部署](https://milvus.io/docs/install_standalone-docker-compose.md)
- [LangGraph 图 API](https://docs.langchain.com/oss/python/langgraph/use-graph-api)
- 官方资料链接详见来源清单。
