import { useCallback } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";
import { useResource } from "@/hooks/use-resource";
import { dateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DraftCard } from "@/components/draft-card";
import { Loading, LoadError, StatusBadge } from "@/components/shared";

export function TicketsPage() {
  const { session, overview } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const { ticketId } = useParams();
  const offset = Math.max(0, Number(params.get("offset")) || 0);
  const sid = session.session_id;
  const revision = session.messages.length;
  const result = useResource(
    useCallback(
      (signal: AbortSignal) => api.tickets(sid, offset, signal),
      [sid, offset],
    ),
    revision,
  );
  return (
    <div className="detail-layout has-detail ticket-layout">
      <section className="panel ticket-panel">
        <div className="panel-title">
          <h2>
            <ClipboardList size={17} />
            正式工单
          </h2>
          <Badge variant="secondary">{result.data?.total ?? "—"} 份</Badge>
        </div>
        <p className="panel-description">
          当前会话已确认保存的工单。待确认草稿单独显示。
        </p>
        {result.error ? (
          <LoadError message={result.error} retry={result.reload} />
        ) : !result.data ? (
          <Loading />
        ) : (
          <>
            {!result.data.tickets.length ? (
              <div className="empty-state ticket-empty">
                <ClipboardList size={36} strokeWidth={1.3} />
                <h3>当前还没有正式工单</h3>
                <p>
                  在助手中整理报障草稿，核对并确认后，
                  <br />
                  工单会保存在这里。
                </p>
                <Button variant="outline" asChild>
                  <Link to="/assistant">
                    前往运维助手
                    <ArrowRight size={15} />
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="ticket-list">
                {result.data.tickets.map((t) => (
                  <Link
                    className={`ticket-item ${ticketId === t.ticket_id ? "selected" : ""}`}
                    key={t.ticket_id}
                    to={`/tickets/${t.ticket_id}?offset=${offset}`}
                  >
                    <div className="ticket-line">
                      <span className="mono tiny">{t.ticket_id}</span>
                      <StatusBadge value={t.status} />
                    </div>
                    <h3>{t.payload.summary}</h3>
                    <p>
                      {overview.sites.find(
                        (s) => s.site_id === t.payload.site_id,
                      )?.name || t.payload.site_id}{" "}
                      · {t.payload.area || "区域待确认"}
                    </p>
                    <div className="ticket-line muted tiny">
                      <span>{dateTime(t.created_at)}</span>
                      <ArrowRight size={15} />
                    </div>
                  </Link>
                ))}
              </div>
            )}
            <div className="pagination">
              <span>
                共 {result.data.total} 份 · 第 {Math.floor(offset / 10) + 1} 页
              </span>
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!offset}
                  onClick={() =>
                    setParams({ offset: String(Math.max(0, offset - 10)) })
                  }
                >
                  <ChevronLeft size={14} />
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={result.data.next_offset === null}
                  onClick={() =>
                    setParams({ offset: String(result.data!.next_offset) })
                  }
                >
                  下一页
                  <ChevronRight size={14} />
                </Button>
              </div>
            </div>
          </>
        )}
      </section>
      <aside className="context-column">
        {ticketId ? (
          <TicketDetail key={`${sid}:${ticketId}`} id={ticketId} />
        ) : (
          <DraftCard />
        )}
      </aside>
    </div>
  );
}
function TicketDetail({ id }: { id: string }) {
  const { session, overview } = useWorkspace();
  const sid = session.session_id;
  const result = useResource(
    useCallback(
      (signal: AbortSignal) => api.ticket(sid, id, signal),
      [sid, id],
    ),
  );
  const t = result.data;
  return (
    <section className="panel" aria-label="工单详情">
      <div className="panel-title">
        <h2>工单详情</h2>
        <Button asChild variant="ghost" size="icon">
          <Link to="/tickets" aria-label="关闭工单详情">
            <X size={16} />
          </Link>
        </Button>
      </div>
      {result.error ? (
        <LoadError message={result.error} retry={result.reload} />
      ) : !t ? (
        <Loading />
      ) : (
        <div className="detail-body">
          <StatusBadge value={t.status} />
          <h3 className="ticket-heading">{t.payload.summary}</h3>
          <p className="mono tiny muted">{t.ticket_id}</p>
          <div className="info-grid">
            <span>所在站点</span>
            <strong>
              {overview.sites.find((s) => s.site_id === t.payload.site_id)
                ?.name || t.payload.site_id}
            </strong>
            <span>故障区域</span>
            <strong>{t.payload.area || "待确认"}</strong>
            <span>保存时间</span>
            <strong>{dateTime(t.created_at)}</strong>
          </div>
          <h4 className="section-label">故障描述</h4>
          <p className="preserve-text">{t.payload.description}</p>
          <h4 className="section-label">影响范围</h4>
          <p>{t.payload.impact || "待确认"}</p>
          <h4 className="section-label">关联设备</h4>
          <div className="button-row">
            {t.payload.device_ids.length ? (
              t.payload.device_ids.map((id) => (
                <Button key={id} variant="outline" size="sm" asChild>
                  <Link to={`/devices/${id}`}>{id}</Link>
                </Button>
              ))
            ) : (
              <p className="muted">未关联设备</p>
            )}
          </div>
          <h4 className="section-label">已确认检查</h4>
          {t.payload.checks.length ? (
            <ul className="check-list">
              {t.payload.checks.map((check, i) => (
                <li key={i}>{check}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">尚未记录已执行的检查。</p>
          )}
          <p className="local-note">
            工单已保存到本机，尚未向外部运维平台派单。
          </p>
        </div>
      )}
    </section>
  );
}
