import { useState } from "react";
import {
  BrowserRouter,
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import {
  ArrowUpRight,
  CircleHelp,
  ClipboardList,
  History,
  Layers3,
  Monitor,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { WorkspaceProvider } from "@/lib/workspace";
import { useWorkspace } from "@/lib/workspace-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AssistantPage } from "@/pages/assistant";
import { DevicesPage } from "@/pages/devices";
import { TicketsPage } from "@/pages/tickets";
import { HistoryPage } from "@/pages/history";

const pages = [
  {
    path: "/assistant",
    title: "运维助手",
    icon: Sparkles,
    description: "结合设备记录与技术资料，让每一步排查有据可循。",
  },
  {
    path: "/devices",
    title: "设备资产",
    icon: Monitor,
    description: "从站点到设备，查看模拟状态与连接关系。",
  },
  {
    path: "/tickets",
    title: "工单中心",
    icon: ClipboardList,
    description: "核对故障信息，管理当前会话的报障记录。",
  },
  {
    path: "/history",
    title: "历史记录",
    icon: History,
    description: "回看过去的排查过程，继续对话或查看关联工单。",
  },
];
function Shell() {
  const { session } = useWorkspace();
  // 切换会话后重建页面局部状态，避免沿用旧案例选择和未发送的输入。
  return <SessionShell key={session.session_id} />;
}
function SessionShell() {
  const { overview, session, busy, notice, clearNotice, newSession } =
    useWorkspace();
  const location = useLocation();
  const navigate = useNavigate();
  const page =
    pages.find((p) => location.pathname.startsWith(p.path)) || pages[0];
  const [scenario, setScenario] = useState(session.scenario_id);
  const [confirmNew, setConfirmNew] = useState(false);
  async function create() {
    if (await newSession(scenario)) {
      setConfirmNew(false);
      navigate("/assistant");
    }
  }
  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        跳到主要内容
      </a>
      <aside className="sidebar">
        <Link to="/assistant" className="brand">
          <span className="brand-mark">
            <Layers3 size={23} />
          </span>
          <span>
            网域<small>NETWORK WORKSPACE</small>
          </span>
        </Link>
        <div className="workspace-label">
          <span className="status-dot" />
          本地演示工作空间
        </div>
        <div className="nav-caption">工作台</div>
        <nav aria-label="主导航">
          {pages.map((p) => (
            <NavLink
              key={p.path}
              to={p.path}
              className={({ isActive }) =>
                `nav-link ${isActive ? "active" : ""}`
              }
            >
              <p.icon size={18} />
              {p.title}
              {p.path === "/tickets" && session.draft && (
                <span className="nav-count">1</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-session">
          <p className="nav-caption">新会话案例</p>
          <select
            aria-label="演示案例"
            value={scenario}
            disabled={!!busy}
            onChange={(e) => {
              setScenario(e.target.value);
              setConfirmNew(false);
            }}
          >
            {Object.entries(overview.scenarios).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            className="new-session"
            disabled={!!busy}
            onClick={() =>
              session.draft ? setConfirmNew(true) : void create()
            }
          >
            <Plus size={16} />
            新建会话
          </Button>
          {confirmNew && (
            <div className="new-session-confirm">
              <p>当前草稿会留在原会话，新会话会使用所选案例。</p>
              <Button size="sm" disabled={!!busy} onClick={() => void create()}>
                继续新建
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmNew(false)}
              >
                返回
              </Button>
            </div>
          )}
        </div>
        <div className="sidebar-bottom">
          <div>
            <CircleHelp size={15} />
            关于演示
          </div>
          <p>
            设备状态为预设快照。
            <br />
            正式工单保存在本机。
          </p>
          <span>网域 / WORKSPACE 01</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            工作空间<span>/</span>
            <strong>{page.title}</strong>
          </div>
          <Badge variant="outline">
            <span className="status-dot" />
            本地演示
          </Badge>
        </header>
        <main id="main-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">NETWORK OPERATIONS</p>
              <h1>{page.title}</h1>
              <p>{page.description}</p>
            </div>
            <div className="overview-stats">
              <div>
                <strong>
                  {overview.sites.length.toString().padStart(2, "0")}
                </strong>
                <span>模拟站点</span>
              </div>
              <div>
                <strong>{overview.device_count}</strong>
                <span>设备资产</span>
              </div>
              <div>
                <strong>{overview.knowledge.chunks}</strong>
                <span>已索引片段</span>
              </div>
            </div>
          </div>
          <div className="session-strip">
            <span>
              <span className="status-dot" />
              当前案例
            </span>
            <strong>{overview.scenarios[session.scenario_id]}</strong>
            <span className="session-id mono">{session.session_id}</span>
          </div>
          {notice && (
            <div className="notice" role="alert">
              <p>{notice}</p>
              <Button
                variant="ghost"
                size="icon"
                aria-label="关闭提示"
                onClick={clearNotice}
              >
                <X size={16} />
              </Button>
            </div>
          )}
          <Routes>
            <Route path="/" element={<Navigate replace to="/assistant" />} />
            <Route path="/assistant" element={<AssistantPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/devices" element={<DevicesPage />} />
            <Route path="/devices/:deviceId" element={<DevicesPage />} />
            <Route path="/tickets" element={<TicketsPage />} />
            <Route path="/tickets/:ticketId" element={<TicketsPage />} />
            <Route
              path="*"
              element={
                <section className="panel empty-state">
                  <h2>页面不存在</h2>
                  <Button asChild>
                    <Link to="/assistant">
                      返回工作台
                      <ArrowUpRight size={16} />
                    </Link>
                  </Button>
                </section>
              }
            />
          </Routes>
          <footer className="page-footer">
            <span>网域 · 多站点网络运维助手</span>
            <span>有依据的排查，有确认的操作。</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
export default function App() {
  return (
    <BrowserRouter>
      <WorkspaceProvider>
        <Shell />
      </WorkspaceProvider>
    </BrowserRouter>
  );
}
