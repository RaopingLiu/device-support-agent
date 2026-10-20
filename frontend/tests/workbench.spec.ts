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
