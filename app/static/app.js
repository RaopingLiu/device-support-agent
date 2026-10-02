// 网页交互入口：原生 JavaScript，无 React/Vue；通过 HTTP 与 main.py 通信。
const $ = (s) => document.querySelector(s);
let sid = localStorage.getItem("network-session"),
  currentDraft = null,
  overview = null,
  nextOffset = 0,
  busy = false;
// 统一 JSON HTTP 请求和错误处理，所有网页数据操作复用它。
async function api(path, method = "GET", body) {
  const r = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = await r.json();
  if (!r.ok)
    throw Error(
      typeof data.detail === "string" ? data.detail : "请求失败，请检查输入",
    );
  return data;
}
// 显示短暂提示，不写入业务数据库。
function toast(text) {
  $("#toast").textContent = text;
  $("#toast").hidden = false;
  setTimeout(() => ($("#toast").hidden = true), 4500);
}
// 用 DOM 节点和 textContent 构造内容，不将模型输出作为 HTML 执行。
function node(tag, text, cls) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}
// 只接受 HTTP/HTTPS 来源链接，新窗口打开并隔离 opener。
function sourceLink(item, label) {
  const a = node("a", label || item.title, "source");
  try {
    const url = new URL(item.source_url, location.origin);
    if (["http:", "https:"].includes(url.protocol)) {
      a.href = url.href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
  } catch {}
  return a;
}
// 只渲染受限的加粗和行内代码，其余内容作为普通文本。
function formatted(text) {
  const box = node("div", undefined, "body");
  for (const part of (text || "").split(/(\*\*[^*]+\*\*|`[^`]+`)/g)) {
    if (part.startsWith("**") && part.endsWith("**"))
      box.append(node("strong", part.slice(2, -2)));
    else if (part.startsWith("`") && part.endsWith("`"))
      box.append(node("code", part.slice(1, -1)));
    else box.append(document.createTextNode(part));
  }
  return box;
}
// 显示一条聊天消息及已核对的引用；持久化由后端负责。
function addMessage(role, data) {
  $(".welcome")?.remove();
  const el = node("article", undefined, "message " + role);
  el.append(
    node(
      "div",
      role === "user" ? "你" : role === "system" ? "工单记录" : "网域助手",
      "role",
    ),
  );
  el.append(formatted(data.reply));
  (data.citations || []).forEach((x, i) =>
    el.append(sourceLink(x, `[${i + 1}] ${x.title} · ${x.section}`)),
  );
  $("#messages").append(el);
  $("#messages").scrollTop = $("#messages").scrollHeight;
}
// 把 SQL 工具字段翻译成可读摘要，区分 online/offline/unknown。
function toolSummary(t) {
  const d = t.result.data;
  if (!d) return t.result.error?.message || "未找到记录";
  if (t.tool === "get_device_status") {
    const states = { online: "在线", offline: "离线", unknown: "未知" };
    const metrics = {
      associated_clients: "关联终端",
      uplink: "上联状态",
      poe: "PoE 状态",
      wan_link: "WAN 链路",
      wan_address_assigned: "WAN 地址已分配",
    };
    return (
      `${d.device_id} · ${states[d.online_state] || d.online_state}\n记录时间：${new Date(d.observed_at).toLocaleString()}\n` +
      Object.entries(d.metrics || {})
        .map(([k, v]) => `${metrics[k] || k}：${v === null ? "未采集" : v}`)
        .join("\n") +
      "\n" +
      (d.alarms || []).join("\n")
    );
  }
  if (t.tool === "find_devices")
    return (
      d.devices
        .map((x) => `${x.device_id} · ${x.area} · ${x.model}`)
        .join("\n") + `\n共 ${d.total} 台，当前展示 ${d.devices.length} 台`
    );
  if (t.tool === "find_sites")
    return d.map((x) => `${x.site_id} · ${x.name}`).join("\n") || "未找到站点";
  if (t.tool === "get_device_neighbors")
    return d
      .map(
        (x) =>
          `${x.src_device_id} → ${x.dst_device_id}\n${x.relation === "uplink" ? "物理上联" : "控制器管理"} ${x.src_port || ""}`,
      )
      .join("\n");
  if (t.tool === "prepare_ticket_draft") return "草稿已整理，等待明确确认。";
  if (t.tool === "get_ticket")
    return `${d.ticket_id} · 待处理\n${d.payload.summary}`;
  return "查询已完成";
}
// 展示本轮设备查询轨迹和检索片段；这是观察记录，不是隐藏思考过程。
function evidence(data) {
  const box = $("#evidence");
  box.replaceChildren();
  const entries = (data.trace || []).filter(
    (x) => x.tool !== "search_knowledge",
  );
  for (const t of entries) {
    const e = node("div", undefined, "evidenceitem");
    const labels = {
      find_sites: "站点定位",
      find_devices: "设备资产",
      get_device_status: "设备状态 · 模拟",
      get_device_neighbors: "连接关系",
      prepare_ticket_draft: "草稿已整理",
      get_ticket: "工单查询",
    };
    e.append(node("strong", labels[t.tool] || "查询记录"));
    e.append(node("pre", toolSummary(t)));
    box.append(e);
  }
  for (const x of data.retrieved || []) {
    const e = node("div", undefined, "evidenceitem");
    e.append(
      node(
        "span",
        x.source_type === "internal_sop" ? "演示 SOP" : "官方资料",
        "badge",
      ),
    );
    e.append(sourceLink(x));
    e.append(node("div", x.text.slice(0, 160) + "…"));
    box.append(e);
  }
  $("#evidenceCount").textContent =
    entries.length + (data.retrieved || []).length;
  if (!box.children.length)
    box.textContent = "本轮无需查询外部资料或设备数据。";
}
// 按后端当前草稿渲染可编辑字段和按钮，保留草稿 ID 与版本。
function renderDraft(d) {
  currentDraft = d;
  const box = $("#draft");
  box.replaceChildren();
  if (!d) {
    box.textContent = "尚无待确认草稿。需要报障时，告诉助手即可。";
    return;
  }
  box.append(node("div", `${d.draft_id} · 版本 ${d.revision}`));
  box.append(
    node("div", `${d.payload.site_id} · ${d.payload.area || "区域待确认"}`),
  );
  for (const [key, title] of [
    ["summary", "摘要"],
    ["description", "故障描述"],
    ["impact", "影响范围"],
  ]) {
    const label = node("label", title, "draftlabel");
    const input = node(key === "description" ? "textarea" : "input");
    input.className = "draftinput";
    input.value = d.payload[key];
    input.id = "draft-" + key;
    input.rows = 4;
    label.append(input);
    box.append(label);
  }
  const actions = node("div", undefined, "draftactions");
  for (const [action, title] of [
    ["edit", "保存修改"],
    ["confirm", "确认提交"],
    ["cancel", "取消"],
  ]) {
    const b = node(
      "button",
      title,
      action === "confirm" ? "primary" : "secondary",
    );
    b.onclick = () => draftAction(action);
    actions.append(b);
  }
  box.append(actions);
}
// 修改/取消/确认直接调业务 API，不把正式提交交给模型判断。
async function draftAction(action) {
  if (busy) return;
  const d = currentDraft;
  if (!d) return;
  const changed = ["summary", "description", "impact"].some(
    (k) => $("#draft-" + k).value !== d.payload[k],
  );
  // 先保存修改再确认，防止用户以为提交了编辑框内容，实际提交的却是旧草稿。
  if (action === "confirm" && changed) {
    toast("请先保存草稿修改，再确认当前版本。");
    return;
  }
  busy = true;
  document
    .querySelectorAll(".draftactions button")
    .forEach((b) => (b.disabled = true));
  try {
    const body = { expected_revision: d.revision }; // 提交页面所见版本，后端拒绝过期草稿。
    if (action === "edit")
      body.payload = {
        ...d.payload,
        summary: $("#draft-summary").value,
        description: $("#draft-description").value,
        impact: $("#draft-impact").value,
      };
    const result = await api(
      `/api/sessions/${sid}/drafts/${d.draft_id}` +
        (action === "edit" ? "" : "/" + action),
      action === "edit" ? "PATCH" : "POST",
      body,
    );
    if (action === "edit") {
      renderDraft(result);
      toast("修改已保存，请核对后确认");
    } else {
      renderDraft(null);
      if (action === "confirm")
        addMessage("system", {
          reply: `工单已保存：${result.ticket_id}\n状态：待处理\n可在对话中查询此工单编号。`,
        });
      else toast("草稿已取消，没有创建工单");
    }
  } catch (e) {
    toast(e.message);
    await restore();
  } finally {
    busy = false;
    document
      .querySelectorAll(".draftactions button")
      .forEach((b) => (b.disabled = false));
  }
}
// 新建会话绑定所选案例，并清空当前页面展示。
async function createSession() {
  const r = await api("/api/sessions", "POST", {
    scenario_id: $("#scenario").value || "ap_offline",
  });
  sid = r.session_id;
  localStorage.setItem("network-session", sid); // 只保存会话 ID，不保存模型凭据；不是身份认证。
  $("#messages").replaceChildren();
  renderDraft(null);
  evidence({});
  addMessage("assistant", {
    reply: "新会话已就绪。你可以按站点、区域或设备编号描述问题。",
  });
}
// 从后端恢复页面消息和有效草稿，本地只记会话标识。
async function restore() {
  if (!sid) {
    await createSession();
    return;
  }
  try {
    const s = await api("/api/sessions/" + sid);
    $("#scenario").value = s.scenario_id;
    $("#messages").replaceChildren();
    s.messages.forEach((x) => addMessage(x.role, x));
    renderDraft(s.draft);
    const last = [...s.messages].reverse().find((x) => x.trace);
    if (last) evidence(last);
  } catch (e) {
    if (e.message.includes("不存在")) await createSession();
    else throw e;
  }
}
// 发消息期间禁用按钮，收到回答后同步消息、依据和草稿。
async function send(text) {
  if (busy || !text.trim()) return;
  busy = true;
  $("#send").disabled = true;
  $("#newSession").disabled = true;
  $("#busy").hidden = false;
  $("#message").value = "";
  addMessage("user", { reply: text });
  try {
    const r = await api(`/api/sessions/${sid}/messages`, "POST", {
      message: text,
    });
    addMessage("assistant", r);
    evidence(r);
    renderDraft(r.draft);
  } catch (e) {
    addMessage("system", { reply: e.message });
  } finally {
    busy = false;
    $("#send").disabled = false;
    $("#newSession").disabled = false;
    $("#busy").hidden = true;
    $("#message").focus();
  }
}
$("#composer").onsubmit = (e) => {
  e.preventDefault();
  send($("#message").value);
};
$("#message").onkeydown = (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send($("#message").value);
  }
};
document
  .querySelectorAll(".examples button")
  .forEach((b) => (b.onclick = () => send(b.textContent)));
$("#newSession").onclick = () => {
  if (!busy) createSession().catch((e) => toast(e.message));
};
// 设备列表直接调用 SQL 资产接口，不经过大模型；offset 支持加载更多。
async function assets(reset = true) {
  if (reset) {
    nextOffset = 0;
    $("#assetRows").replaceChildren();
  }
  const r = await api(
    `/api/sessions/${sid}/devices?site_id=${encodeURIComponent($("#siteFilter").value)}&offset=${nextOffset || 0}`,
  );
  for (const d of r.devices) {
    const tr = node("tr");
    for (const v of [
      d.device_id,
      overview.sites.find((s) => s.site_id === d.site_id)?.name,
      d.area,
      {
        ap: "无线 AP",
        switch: "交换机",
        gateway: "出口网关",
        controller: "控制器",
      }[d.device_type],
      d.model,
    ])
      tr.append(node("td", v));
    $("#assetRows").append(tr);
  }
  nextOffset = r.next_offset;
  $("#moreAssets").hidden = nextOffset === null;
}
document.querySelectorAll("[data-view]").forEach(
  (b) =>
    (b.onclick = () => {
      document
        .querySelectorAll("[data-view]")
        .forEach((x) => x.classList.toggle("active", x === b));
      $("#chatView").hidden = b.dataset.view !== "chat";
      $("#assetsView").hidden = b.dataset.view !== "assets";
      if (b.dataset.view === "assets") assets().catch((e) => toast(e.message));
    }),
);
$("#siteFilter").onchange = () => assets().catch((e) => toast(e.message));
$("#moreAssets").onclick = () => assets(false).catch((e) => toast(e.message));
// 页面启动：获取概览、填充选项，再恢复或创建会话。
(async () => {
  try {
    overview = await api("/api/overview");
    $("#siteCount").textContent = overview.sites.length;
    $("#deviceCount").textContent = overview.device_count;
    $("#chunkCount").textContent = overview.knowledge.chunks;
    for (const [id, label] of Object.entries(overview.scenarios))
      $("#scenario").append(new Option(label, id));
    $("#scenario").value = "ap_offline";
    $("#siteFilter").append(new Option("所有站点", ""));
    overview.sites.forEach((s) =>
      $("#siteFilter").append(new Option(s.name, s.site_id)),
    );
    if (sid) await restore();
    else {
      const r = await api("/api/sessions", "POST", {
        scenario_id: "ap_offline",
      });
      sid = r.session_id;
      localStorage.setItem("network-session", sid); // 只保存会话 ID，不保存模型凭据；不是身份认证。
    }
  } catch (e) {
    toast(e.message);
  }
})();
