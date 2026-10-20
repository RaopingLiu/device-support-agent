import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import {
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  CircleCheck,
  Search,
  Sparkles,
} from "lucide-react";
import { useWorkspace } from "@/lib/workspace-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { DraftCard } from "@/components/draft-card";
import { Loading, MessageText, SourceLink } from "@/components/shared";
import type { ToolTrace } from "@/lib/types";

const toolLabels: Record<string, string> = {
  find_sites: "站点定位",
  find_devices: "设备资产",
  get_device_status: "设备状态",
  get_device_neighbors: "连接关系",
  prepare_ticket_draft: "整理草稿",
  get_ticket: "工单查询",
};
function traceSummary(trace: ToolTrace) {
  const states: Record<string, string> = {
    online: "在线",
    offline: "离线",
    unknown: "未知",
  };
  if (trace.result.status !== "ok")
    return trace.result.error?.message || "未找到记录";
  const d = trace.result.data as Record<string, unknown> | null;
  if (!d) return "查询完成";
  if (trace.tool === "get_device_status")
    return `${d.device_id} · ${states[String(d.online_state)] || "未知"}（模拟快照）`;
  if (trace.tool === "find_devices") return `找到 ${d.total} 台设备`;
  if (trace.tool === "prepare_ticket_draft")
    return "草稿已整理，等待你核对并确认。";
  if (trace.tool === "get_ticket") return `${d.ticket_id} · 已保存`;
  if (Array.isArray(d))
    return (
      d
        .map((x) => x.name || `${x.src_device_id} → ${x.dst_device_id}`)
        .join("；") || "没有匹配记录"
    );
  return "查询完成";
}

export function AssistantPage() {
  const { session } = useWorkspace();
  const [params] = useSearchParams();
  const device = params.get("device");
  return (
    <AssistantConversation
      key={`${session.session_id}:${device || ""}`}
      device={device}
    />
  );
}
function AssistantConversation({ device }: { device: string | null }) {
  const { session, busy, send } = useWorkspace();
  const [input, setInput] = useState(
    device ? `请帮我排查设备 ${device} 的网络问题，先查询状态和连接关系。` : "",
  );
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [session.messages.length, busy]);
  const last = [...session.messages].reverse().find((m) => m.trace);
  const traces =
    last?.trace?.filter((t) => t.tool !== "search_knowledge") || [];
  const sources = last?.retrieved || [];
  function submit() {
    if (busy || !input.trim()) return;
    const text = input.trim();
    setInput("");
    void send(text);
  }
  return (
    <div className="workspace-grid">
      <section className="panel conversation" aria-label="运维对话">
        <div className="panel-title">
          <h2>
            <Sparkles size={17} />
            运维助手
          </h2>
          <Badge variant="outline">当前会话</Badge>
        </div>
        <div
          className="messages"
          aria-live="polite"
          aria-relevant="additions text"
        >
          {!session.messages.length && (
            <div className="welcome">
              <div className="welcome-symbol">
                <Sparkles size={28} strokeWidth={1.5} />
              </div>
              <p className="eyebrow">YOUR NETWORK, IN CONTEXT</p>
              <h2>从一个网络问题开始。</h2>
              <p>
                查设备、找依据、整理报障。
                <br />
                告诉我设备编号，或描述站点和故障现象。
              </p>
              <div className="suggestions">
                {[
                  "杭州仓库有哪些 AP？",
                  "S01-AP04 在线吗？",
                  "仓储区 Wi-Fi 掉线，怎么排查？",
                  "什么是 PoE？",
                ].map((text) => (
                  <button
                    disabled={!!busy}
                    key={text}
                    onClick={() => {
                      setInput(text);
                    }}
                  >
                    {text}
                    <ArrowUpRight size={15} />
                  </button>
                ))}
              </div>
            </div>
          )}
          {session.messages.map((message, i) => (
            <article className={`chat-message ${message.role}`} key={i}>
              <div className="message-label">
                {message.role === "user"
                  ? "你"
                  : message.role === "system"
                    ? "工单记录"
                    : "网域助手"}
              </div>
              <MessageText text={message.reply} />
              {!!message.citations?.length && (
                <div className="citations">
                  {message.citations.map((source, n) => (
                    <SourceLink
                      key={source.chunk_id}
                      source={source}
                      number={n + 1}
                    />
                  ))}
                </div>
              )}
            </article>
          ))}
          {busy === "chat" && <Loading text="正在查询与整理，请稍候…" />}
          <div ref={end} />
        </div>
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Textarea
            aria-label="输入问题"
            placeholder="描述网络问题，或输入设备编号…"
            value={input}
            maxLength={4000}
            rows={3}
            disabled={busy === "session"}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing &&
                e.keyCode !== 229
              ) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="composer-footer">
            <span>Enter 发送 · Shift + Enter 换行</span>
            <Button
              size="icon"
              aria-label="发送消息"
              disabled={!!busy || !input.trim()}
            >
              <ArrowUp size={19} />
            </Button>
          </div>
        </form>
        <p className="conversation-footnote">
          设备状态为模拟快照 · 具体操作请结合现场情况核实
        </p>
      </section>
      <aside className="context-column">
        <section className="panel" aria-label="本轮依据">
          <div className="panel-title">
            <h2>
              <BookOpen size={17} />
              本轮依据
            </h2>
            <Badge variant="secondary">{traces.length + sources.length}</Badge>
          </div>
          <div className="evidence-list">
            {!traces.length && !sources.length ? (
              <div className="empty-state compact">
                <Search size={26} />
                <p>每一步查询，都有迹可循</p>
                <span>设备查询记录与资料来源会显示在这里。</span>
              </div>
            ) : (
              <>
                {traces.map((t, i) => (
                  <div className="evidence-item" key={i}>
                    <h3>
                      <CircleCheck size={14} />
                      {toolLabels[t.tool] || "查询记录"}
                    </h3>
                    <p>{traceSummary(t)}</p>
                  </div>
                ))}
                {sources.map((s, i) => (
                  <div className="evidence-item" key={`${s.chunk_id}:${i}`}>
                    <Badge variant="outline">
                      {s.source_type === "internal_sop"
                        ? "演示 SOP"
                        : "官方资料"}
                    </Badge>
                    <SourceLink source={s} />
                    <p>
                      {s.text.slice(0, 180)}
                      {s.text.length > 180 ? "…" : ""}
                    </p>
                  </div>
                ))}
              </>
            )}
          </div>
        </section>
        <DraftCard />
        <p className="aside-note">
          先核对，再提交。
          <br />
          只有明确确认，草稿才会保存为正式工单。
        </p>
      </aside>
    </div>
  );
}
