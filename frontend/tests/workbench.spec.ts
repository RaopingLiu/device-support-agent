import { test, expect } from "@playwright/test";

test("设备详情 → 助手 → 草稿编辑确认 → 工单刷新恢复", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/devices");
  await page.getByLabel("搜索设备编号或型号").fill("S01-AP04");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.getByRole("row")).toHaveCount(2);
  await page.getByRole("link", { name: "查看 S01-AP04" }).click();
  await expect(
    page.getByRole("complementary", { name: "设备详情" }),
  ).toContainText("离线");
  await page.reload();
  await expect(
    page.getByRole("complementary", { name: "设备详情" }),
  ).toContainText("物理上联");
  await page.getByRole("link", { name: "围绕此设备排查" }).click();
  await expect(page.getByLabel("输入问题")).toHaveValue(/S01-AP04/);
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.getByRole("region", { name: "运维对话" })).toContainText(
    "测试替身：S01-AP04",
  );
  await page
    .getByLabel("输入问题")
    .fill("请整理报障工单，现场尚未做任何检查。");
  await page.getByRole("button", { name: "发送消息" }).click();
  const draft = page.getByRole("region", { name: "报障草稿" });
  await expect(draft.getByLabel("摘要", { exact: true })).toHaveValue(
    "仓储区 AP 离线",
  );
  // 真正列表接口证明模型生成草稿后尚无正式工单。
  const sid = await page.evaluate(() =>
    localStorage.getItem("network-session"),
  );
  expect(
    (await (await page.request.get(`/api/sessions/${sid}/tickets`)).json())
      .total,
  ).toBe(0);
  await draft
    .getByLabel("摘要", { exact: true })
    .fill("仓储区扫码终端无法联网");
  await expect(
    draft.getByRole("button", { name: "确认提交", exact: true }),
  ).toBeDisabled();
  await draft.getByRole("button", { name: "保存修改" }).click();
  await expect(draft).toContainText("版本 2");
  await draft.getByRole("button", { name: "确认提交", exact: true }).click();
  await draft.getByRole("button", { name: "确认保存工单" }).click();
  await expect(page).toHaveURL(/\/tickets\/T-/);
  await expect(page.getByRole("region", { name: "工单详情" })).toContainText(
    "仓储区扫码终端无法联网",
  );
  await page.reload();
  await expect(page.getByRole("region", { name: "工单详情" })).toContainText(
    "仓储区扫码终端无法联网",
  );
  expect(
    (await (await page.request.get(`/api/sessions/${sid}/tickets`)).json())
      .total,
  ).toBe(1);
  expect(errors).toEqual([]);
});

test("旧版本确认显示冲突并刷新草稿，不产生工单", async ({ page }) => {
  await page.goto("/assistant");
  await page.getByLabel("输入问题").fill("请整理报障工单");
  await page.getByRole("button", { name: "发送消息" }).click();
  const panel = page.getByRole("region", { name: "报障草稿" });
  await expect(panel).toContainText("版本 1");
  const sid = await page.evaluate(() =>
    localStorage.getItem("network-session"),
  );
  const session = await (await page.request.get(`/api/sessions/${sid}`)).json();
  const draft = session.draft;
  // 模拟另一标签页更新了草稿，当前页面仍持有版本 1。
  await page.request.patch(`/api/sessions/${sid}/drafts/${draft.draft_id}`, {
    data: {
      expected_revision: 1,
      payload: { ...draft.payload, summary: "另一页面已更新的故障摘要" },
    },
  });
  await panel.getByRole("button", { name: "确认提交", exact: true }).click();
  await panel.getByRole("button", { name: "确认保存工单" }).click();
  await expect(page.getByRole("alert")).toContainText("草稿已更新");
  await expect(panel.getByLabel("摘要", { exact: true })).toHaveValue(
    "另一页面已更新的故障摘要",
  );
  expect(
    (await (await page.request.get(`/api/sessions/${sid}/tickets`)).json())
      .total,
  ).toBe(0);
  await panel.getByRole("button", { name: "取消草稿" }).click();
  await expect(panel).toContainText("当前没有待确认草稿");
});

test("窄屏设备空结果、网络错误重试和场景切换", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/devices");
  await page.getByLabel("搜索设备编号或型号").fill("不存在的设备");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.getByText("没有找到匹配设备")).toBeVisible();
  await page.getByRole("button", { name: "清除筛选" }).click();
  await page.route("**/api/sessions/*/devices?*", (route) =>
    route.fulfill({ status: 503, json: { detail: "测试：设备服务暂不可用" } }),
  );
  await page.getByLabel("站点筛选").selectOption("S01");
  await expect(page.getByRole("alert")).toContainText("设备服务暂不可用");
  await page.unroute("**/api/sessions/*/devices?*");
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await page.getByRole("link", { name: "查看 S01-AP04" }).click();
  await expect(
    page.getByRole("complementary", { name: "设备详情" }),
  ).toContainText("离线");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByLabel("演示案例").selectOption("normal");
  await page.getByRole("button", { name: "新建会话", exact: true }).click();
  await expect(page).toHaveURL(/\/assistant$/);
  await page.goto("/devices/S01-AP04");
  await expect(
    page.getByRole("complementary", { name: "设备详情" }),
  ).toContainText("在线");
});

test("历史搜索找回旧会话、恢复草稿并继续对话，关联工单可再次打开", async ({
  page,
}) => {
  await page.goto("/assistant");
  await page.getByLabel("输入问题").fill("历史回看：仓储区反复掉线");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.getByRole("region", { name: "运维对话" })).toContainText(
    "测试替身",
  );
  const oldSid = await page.evaluate(() =>
    localStorage.getItem("network-session"),
  );
  await page.getByLabel("输入问题").fill("请整理报障工单");
  await page.getByRole("button", { name: "发送消息" }).click();
  const draft = page.getByRole("region", { name: "报障草稿" });
  await draft.getByLabel("影响范围").fill("历史记录中保存的扫码作业影响");
  await draft.getByRole("button", { name: "保存修改" }).click();
  await expect(draft).toContainText("版本 2");
  await page.getByLabel("演示案例").selectOption("normal");
  await page.getByRole("button", { name: "新建会话", exact: true }).click();
  await page.getByRole("button", { name: "继续新建" }).click();
  await expect(draft).toContainText("当前没有待确认草稿");
  await expect(page.getByLabel("输入问题")).toHaveValue("");
  const newSid = await page.evaluate(() =>
    localStorage.getItem("network-session"),
  );
  expect(newSid).not.toBe(oldSid);
  await page.getByLabel("输入问题").fill("历史回看：办公区网络检查");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.getByRole("region", { name: "运维对话" })).toContainText(
    "测试替身",
  );
  await page.getByRole("link", { name: "历史记录", exact: true }).click();
  await page.getByLabel("搜索历史对话").fill("仓储区反复掉线");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  const oldItem = page.getByRole("article", {
    name: "历史回看：仓储区反复掉线",
    exact: true,
  });
  await expect(oldItem).toContainText("有待确认草稿");
  expect(
    await page.evaluate(() => localStorage.getItem("network-session")),
  ).toBe(newSid);
  await oldItem.getByRole("button", { name: "打开对话" }).click();
  await expect(page).toHaveURL(/\/assistant$/);
  await expect(page.getByLabel("演示案例")).toHaveValue("ap_offline");
  await expect(draft.getByLabel("影响范围")).toHaveValue(
    "历史记录中保存的扫码作业影响",
  );
  await page.reload();
  await expect(draft).toContainText("版本 2");
  expect(
    await page.evaluate(() => localStorage.getItem("network-session")),
  ).toBe(oldSid);
  await page.getByLabel("输入问题").fill("补充反馈：已检查现场网线");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(
    page.getByRole("button", { name: "确认提交", exact: true }),
  ).toBeEnabled();
  const restored = await (
    await page.request.get(`/api/sessions/${oldSid}`)
  ).json();
  expect(restored.messages[0].reply).toBe("历史回看：仓储区反复掉线");
  expect(restored.messages.at(-2).reply).toBe("补充反馈：已检查现场网线");
  expect(
    (await (await page.request.get(`/api/sessions/${newSid}`)).json()).messages,
  ).toHaveLength(2);
  await draft.getByRole("button", { name: "确认提交", exact: true }).click();
  await draft.getByRole("button", { name: "确认保存工单" }).click();
  await expect(page.getByRole("region", { name: "工单详情" })).toBeVisible();
  await page.getByRole("link", { name: "历史记录", exact: true }).click();
  await page
    .getByRole("article", { name: "历史回看：办公区网络检查", exact: true })
    .getByRole("button", { name: "打开对话" })
    .click();
  await expect(page.getByLabel("演示案例")).toHaveValue("normal");
  await page.getByRole("link", { name: "历史记录", exact: true }).click();
  await oldItem.getByRole("button", { name: "查看工单" }).click();
  await expect(page).toHaveURL(/\/tickets$/);
  await expect(page.getByText("仓储区 AP 离线", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("network-session")),
  ).toBe(oldSid);
});

test("历史切换失败保留当前会话，处理消息时禁止切换，窄屏搜索可用", async ({
  page,
}) => {
  await page.goto("/assistant");
  await expect(page.getByLabel("输入问题")).toBeVisible();
  const current = await page.evaluate(() =>
    localStorage.getItem("network-session"),
  );
  const other = (
    await (
      await page.request.post("/api/sessions", {
        data: { scenario_id: "wan_down" },
      })
    ).json()
  ).session_id;
  await page.request.post(`/api/sessions/${other}/messages`, {
    data: { message: "切换失败测试的历史对话" },
  });
  await page.getByRole("link", { name: "历史记录", exact: true }).click();
  const item = page.getByRole("article", {
    name: "切换失败测试的历史对话",
    exact: true,
  });
  await page.route(`**/api/sessions/${other}`, (route) =>
    route.fulfill({
      status: 503,
      json: { detail: "测试：历史会话暂时无法打开" },
    }),
  );
  await item.getByRole("button", { name: "打开对话" }).click();
  await expect(page.getByRole("alert")).toContainText("历史会话暂时无法打开");
  expect(
    await page.evaluate(() => localStorage.getItem("network-session")),
  ).toBe(current);
  await page.unroute(`**/api/sessions/${other}`);
  await item.getByRole("button", { name: "打开对话" }).click();
  await expect(page.getByLabel("演示案例")).toHaveValue("wan_down");
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/sessions/${other}/messages`, async (route) => {
    await pending;
    await route.continue();
  });
  try {
    await page.getByLabel("输入问题").fill("继续排查出口链路");
    await page.getByRole("button", { name: "发送消息" }).click();
    await page.getByRole("link", { name: "历史记录", exact: true }).click();
    await expect(item.getByRole("button", { name: "打开对话" })).toBeDisabled();
  } finally {
    release();
  }
  await expect(item.getByRole("button", { name: "打开对话" })).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("搜索历史对话").fill("找不到的历史记录关键词");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.getByText("没有找到匹配的历史记录")).toBeVisible();
  await page.getByRole("button", { name: "清除搜索" }).click();
  await expect(item).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "历史记录", exact: true }),
  ).toBeVisible();
});
