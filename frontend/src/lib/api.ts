import type {
  ChatReply,
  DeviceDetail,
  DevicePage,
  Draft,
  DraftPayload,
  Overview,
  Session,
  Ticket,
  TicketPage,
} from "./types";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// 只读请求可被页面卸载取消。写操作失败后重新查询服务器，避免盲目重试造成重复动作。
export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    throw new ApiError("无法连接服务，请检查后端是否启动后重试。", 0);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.detail;
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail
              .map(
                (x: { loc: string[]; msg: string }) =>
                  `${x.loc.at(-1)}：${x.msg}`,
              )
              .join("；")
          : `请求失败（${response.status}）`;
    throw new ApiError(message, response.status);
  }
  if (data === null)
    throw new ApiError("服务返回了无法识别的数据，请重试。", response.status);
  return data as T;
}
const base = (sid: string) => `/api/sessions/${encodeURIComponent(sid)}`;
const json = (body: unknown, method = "POST") => ({
  method,
  body: JSON.stringify(body),
});
export const api = {
  overview: () => request<Overview>("/api/overview"),
  createSession: (scenario_id: string) =>
    request<{ session_id: string }>("/api/sessions", json({ scenario_id })),
  session: (sid: string) => request<Session>(base(sid)),
  chat: (sid: string, message: string) =>
    request<ChatReply>(`${base(sid)}/messages`, json({ message })),
  devices: (sid: string, params: URLSearchParams, signal?: AbortSignal) =>
    request<DevicePage>(`${base(sid)}/devices?${params}`, { signal }),
  device: (sid: string, id: string, signal?: AbortSignal) =>
    request<DeviceDetail>(`${base(sid)}/devices/${encodeURIComponent(id)}`, {
      signal,
    }),
  tickets: (sid: string, offset: number, signal?: AbortSignal) =>
    request<TicketPage>(`${base(sid)}/tickets?offset=${offset}&limit=10`, {
      signal,
    }),
  ticket: (sid: string, id: string, signal?: AbortSignal) =>
    request<Ticket>(`${base(sid)}/tickets/${encodeURIComponent(id)}`, {
      signal,
    }),
  editDraft: (sid: string, d: Draft, payload: DraftPayload) =>
    request<Draft>(
      `${base(sid)}/drafts/${d.draft_id}`,
      json({ expected_revision: d.revision, payload }, "PATCH"),
    ),
  confirmDraft: (sid: string, d: Draft) =>
    request<Ticket>(
      `${base(sid)}/drafts/${d.draft_id}/confirm`,
      json({ expected_revision: d.revision }),
    ),
  cancelDraft: (sid: string, d: Draft) =>
    request<Draft>(
      `${base(sid)}/drafts/${d.draft_id}/cancel`,
      json({ expected_revision: d.revision }),
    ),
};
