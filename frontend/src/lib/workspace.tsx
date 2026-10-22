import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "./api";
import type { Draft, DraftPayload, Session } from "./types";
import {
  WorkspaceContext as Context,
  type Operation,
} from "./workspace-context";
const storageKey = "network-session";
async function boot() {
  const overview = await api.overview();
  const sid = localStorage.getItem(storageKey);
  if (sid) {
    try {
      return { overview, session: await api.session(sid) };
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) throw error;
    }
  }
  const created = await api.createSession("ap_offline");
  localStorage.setItem(storageKey, created.session_id);
  return { overview, session: await api.session(created.session_id) };
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof boot>>>();
  const [bootError, setBootError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<Operation>(null);
  const lock = useRef(false);
  // StrictMode 会重跑 effect；同一次启动复用 promise，避免创建两个会话。
  const bootRequest = useRef<ReturnType<typeof boot> | null>(null);
  useEffect(() => {
    let active = true;
    bootRequest.current ??= boot();
    bootRequest.current
      .then((value) => {
        if (active) setData(value);
      })
      .catch((error) => {
        if (active) setBootError(error.message);
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  function updateSession(session: Session) {
    setData((previous) => (previous ? { ...previous, session } : previous));
  }
  function begin(operation: Operation) {
    if (lock.current) return false;
    lock.current = true;
    setBusy(operation);
    setNotice("");
    return true;
  }
  function finish() {
    lock.current = false;
    setBusy(null);
  }
  async function recover(sid: string, error: unknown) {
    let message = error instanceof Error ? error.message : "操作失败";
    try {
      updateSession(await api.session(sid));
    } catch {
      message += " 当前结果尚未核实，请刷新页面后查看记录。";
    }
    setNotice(message);
  }
  async function send(message: string) {
    if (!data || !message.trim() || !begin("chat")) return;
    const session = data.session;
    updateSession({
      ...session,
      messages: [...session.messages, { role: "user", reply: message }],
    });
    try {
      const reply = await api.chat(session.session_id, message);
      updateSession({
        ...session,
        draft: reply.draft,
        messages: [
          ...session.messages,
          { role: "user", reply: message },
          { ...reply, role: "assistant" },
        ],
      });
    } catch (error) {
      await recover(session.session_id, error);
    } finally {
      finish();
    }
  }
  async function newSession(scenario: string) {
    if (!begin("session")) return false;
    try {
      const created = await api.createSession(scenario);
      const session = await api.session(created.session_id);
      localStorage.setItem(storageKey, session.session_id);
      updateSession(session);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "新建失败");
      return false;
    } finally {
      finish();
    }
  }
  async function switchSession(sid: string) {
    // 与聊天、草稿写入共用互斥锁；读取成功后才替换当前会话。
    if (!begin("session")) return false;
    try {
      const session = await api.session(sid);
      localStorage.setItem(storageKey, session.session_id);
      updateSession(session);
      return true;
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "打开会话失败，请重试。",
      );
      return false;
    } finally {
      finish();
    }
  }
  async function editDraft(d: Draft, payload: DraftPayload) {
    if (!data || !begin("draft")) return;
    try {
      updateSession({
        ...data.session,
        draft: await api.editDraft(data.session.session_id, d, payload),
      });
    } catch (error) {
      await recover(data.session.session_id, error);
    } finally {
      finish();
    }
  }
  async function confirmDraft(d: Draft) {
    if (!data || !begin("draft")) return;
    try {
      const ticket = await api.confirmDraft(data.session.session_id, d);
      updateSession({
        ...data.session,
        draft: null,
        messages: [
          ...data.session.messages,
          { role: "system", reply: `工单已保存：${ticket.ticket_id}` },
        ],
      });
      return ticket;
    } catch (error) {
      await recover(data.session.session_id, error);
    } finally {
      finish();
    }
  }
  async function cancelDraft(d: Draft) {
    if (!data || !begin("draft")) return;
    try {
      await api.cancelDraft(data.session.session_id, d);
      updateSession({ ...data.session, draft: null });
    } catch (error) {
      await recover(data.session.session_id, error);
    } finally {
      finish();
    }
  }
  if (!data)
    return (
      <main className="boot-screen">
        <div className="brand-mark">网</div>
        <h1>网域 · 运维工作台</h1>
        {bootError ? (
          <>
            <p role="alert">{bootError}</p>
            <button
              className="retry-button"
              onClick={() => {
                bootRequest.current = null;
                setBootError("");
                setAttempt((x) => x + 1);
              }}
            >
              重新连接
            </button>
          </>
        ) : (
          <p role="status">正在加载工作空间…</p>
        )}
      </main>
    );
  return (
    <Context
      value={{
        ...data,
        busy,
        notice,
        clearNotice: () => setNotice(""),
        send,
        newSession,
        switchSession,
        editDraft,
        confirmDraft,
        cancelDraft,
      }}
    >
      {children}
    </Context>
  );
}
