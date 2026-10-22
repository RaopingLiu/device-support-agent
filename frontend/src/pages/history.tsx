import { useCallback, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock3,
  History,
  MessageSquare,
  RefreshCw,
  Search,
} from "lucide-react";
import { api } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";
import { dateTime } from "@/lib/utils";
import { useResource } from "@/hooks/use-resource";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loading, LoadError } from "@/components/shared";

function HistorySearch({
  query,
  submit,
}: {
  query: string;
  submit: (value: string) => void;
}) {
  const [value, setValue] = useState(query);
  return (
    <form
      className="search-form"
      onSubmit={(event) => {
        event.preventDefault();
        submit(value.trim());
      }}
    >
      <Search size={16} />
      <Input
        aria-label="搜索历史对话"
        placeholder="搜索设备编号、故障现象或对话内容…"
        maxLength={200}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <Button type="submit" variant="ghost" size="sm">
        搜索
      </Button>
    </form>
  );
}

export function HistoryPage() {
  const { session, overview, busy, switchSession } = useWorkspace();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const query = params.get("q") || "";
  const rawOffset = Number(params.get("offset") || 0);
  const offset =
    Number.isSafeInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
  const result = useResource(
    useCallback(
      (signal: AbortSignal) =>
        api.sessions(
          new URLSearchParams({
            q: query,
            offset: String(offset),
            limit: "12",
          }),
          signal,
        ),
      [query, offset],
    ),
    session.messages.length,
  );
  function search(value: string) {
    setParams(value ? { q: value } : {});
  }
  function page(next: number) {
    setParams({ ...(query ? { q: query } : {}), offset: String(next) });
  }
  async function open(sid: string, destination: string) {
    if (await switchSession(sid)) navigate(destination);
  }
  return (
    <section className="panel history-panel" aria-label="历史会话">
      <div className="panel-title">
        <h2>
          <History size={17} />
          历史会话
        </h2>
        <Button variant="ghost" size="sm" onClick={result.reload}>
          <RefreshCw size={14} />
          刷新列表
        </Button>
      </div>
      <p className="panel-description">
        保存在本机的对话记录。打开后可查看完整消息、资料来源和已保存的草稿，继续上次的排查。
      </p>
      <div className="filter-bar">
        <HistorySearch key={query} query={query} submit={search} />
        {query && (
          <Button variant="outline" onClick={() => search("")}>
            清除搜索
          </Button>
        )}
      </div>
      {result.error ? (
        <LoadError message={result.error} retry={result.reload} />
      ) : !result.data ? (
        <Loading />
      ) : (
        <>
          {!result.data.sessions.length ? (
            <div className="empty-state ticket-empty">
              <History size={36} strokeWidth={1.3} />
              <h3>{query ? "没有找到匹配的历史记录" : "还没有历史对话"}</h3>
              <p>
                {query
                  ? "试试设备编号、故障关键词，或清除搜索查看全部记录。"
                  : "在运维助手中开始对话后，可以在这里回看。"}
              </p>
            </div>
          ) : (
            <ul className="history-list">
              {result.data.sessions.map((item) => (
                <li key={item.session_id}>
                  <article
                    className={`history-item ${item.session_id === session.session_id ? "current" : ""}`}
                    aria-label={item.title}
                  >
                    <div className="history-item-heading">
                      <h3>{item.title}</h3>
                      <div className="history-badges">
                        {item.session_id === session.session_id && (
                          <Badge variant="outline">当前会话</Badge>
                        )}
                        {item.has_draft && (
                          <Badge variant="secondary">有待确认草稿</Badge>
                        )}
                      </div>
                    </div>
                    <p className="history-scenario">
                      {overview.scenarios[item.scenario_id] || item.scenario_id}
                    </p>
                    <p className="history-preview">
                      {item.preview || "尚未发送消息，可以打开后开始排查。"}
                    </p>
                    <div className="history-item-footer">
                      <div className="history-meta">
                        <span>
                          <Clock3 size={13} />
                          <time dateTime={item.updated_at}>
                            {dateTime(item.updated_at)}
                          </time>
                        </span>
                        <span>
                          <MessageSquare size={13} />
                          {item.message_count} 条消息
                        </span>
                        <span>
                          <ClipboardList size={13} />
                          {item.ticket_count} 份工单
                        </span>
                      </div>
                      <div className="history-actions">
                        {item.ticket_count > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={!!busy}
                            onClick={() =>
                              void open(item.session_id, "/tickets")
                            }
                          >
                            查看工单
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!!busy}
                          onClick={() =>
                            void open(item.session_id, "/assistant")
                          }
                        >
                          打开对话
                          <ArrowUpRight size={14} />
                        </Button>
                      </div>
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          )}
          <div className="pagination">
            <span>
              共 {result.data.total} 个会话 · 第 {Math.floor(offset / 12) + 1}{" "}
              页
            </span>
            <div>
              <Button
                variant="outline"
                size="sm"
                disabled={!offset}
                onClick={() => page(Math.max(0, offset - 12))}
              >
                <ChevronLeft size={14} />
                上一页
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={result.data.next_offset === null}
                onClick={() => page(result.data!.next_offset!)}
              >
                下一页
                <ChevronRight size={14} />
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
