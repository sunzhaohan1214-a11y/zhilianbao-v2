import { expect, test, type Page } from "@playwright/test";
import { e2eUsers, seedAuthFixtures } from "./auth-fixtures";
import { futureShanghaiPresenceInterval } from "./presence-time";

async function login(page: Page) {
  const response = await page.request.post("/api/v2/auth/login", {
    headers: { origin: "http://127.0.0.1:3000" },
    data: { phone: e2eUsers.normal.phone, password: e2eUsers.normal.password },
  });
  expect(response.ok()).toBe(true);
}

async function fillPresence(page: Page, daysAhead: number, note: string) {
  const interval = futureShanghaiPresenceInterval(new Date(), daysAhead);
  await page.goto("/presence/new");
  await expect(page.locator("form")).toHaveAttribute("aria-busy", "false");
  await page.getByLabel("到宝时间").fill(interval.arrivalAtLocal);
  await page.getByLabel("预计离宝时间").fill(interval.expectedDepartureAtLocal);
  await page.getByLabel("备注（选填）").fill(note);
  return interval;
}

test.beforeEach(async () => { await seedAuthFixtures(); });

test("@weak-network AI query exposes loading, prevents duplicate submission, and supports explicit retry", async ({ page }) => {
  await login(page);
  let calls = 0;
  await page.route("**/api/v2/ai/chat", async (route) => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 600));
    if (calls === 1) await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "网络暂不可用" } }) });
    else await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { answer: "已安全重试", degraded: true, evidence: [] } }) });
  });
  await page.goto("/ai");
  await page.getByLabel("想查询什么？").fill("查找测试需求");
  const submit = page.getByRole("button", { name: "查询" });
  await submit.dblclick();
  await expect(page.getByRole("status")).toContainText("请勿重复提交");
  await expect(page.getByRole("alert").filter({ hasText: "网络暂不可用" })).toContainText("网络暂不可用");
  expect(calls).toBe(1);
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByText("已安全重试")).toBeVisible();
  expect(calls).toBe(2);
});

test("@weak-network Presence preserves its draft after a failed request and supports explicit retry", async ({ page }) => {
  await login(page);
  let calls = 0;
  await page.route("**/api/v2/presence", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    calls += 1;
    if (calls === 1) await route.abort("failed");
    else await route.continue();
  });
  const note = "E2E Presence 请求前断网";
  await fillPresence(page, 31, note);

  await page.getByRole("button", { name: "提交报备" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "报备内容已保留" })).toContainText("报备内容已保留");
  await expect(page.getByLabel("备注（选填）")).toHaveValue(note);
  await expect(page.getByRole("button", { name: "重新提交" })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("presence-new-draft"))).toContain(note);

  await page.getByRole("button", { name: "重新提交" }).click();
  await expect(page).toHaveURL(/\/presence$/);
  await expect(page.getByText(note, { exact: true })).toHaveCount(1);
  expect(calls).toBe(2);
});

test("@weak-network Presence response-lost retry returns the committed record exactly once and replaces stale form history", async ({ page }) => {
  await login(page);
  let calls = 0;
  await page.route("**/api/v2/presence", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    calls += 1;
    if (calls === 1) {
      const committed = await route.fetch();
      expect(committed.status()).toBe(201);
      await route.abort("failed");
    } else {
      await route.continue();
    }
  });
  const note = "E2E Presence 响应丢失幂等";
  await page.goto("/presence");
  const interval = await fillPresence(page, 32, note);

  await page.getByRole("button", { name: "提交报备" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "报备内容已保留" })).toContainText("报备内容已保留");
  await expect(page.getByLabel("备注（选填）")).toHaveValue(note);
  await page.getByRole("button", { name: "重新提交" }).click();
  await expect(page).toHaveURL(/\/presence$/);
  await expect(page.getByText(note, { exact: true })).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("presence-new-draft"))).toBeNull();

  const response = await page.request.get("/api/v2/presence/me");
  expect(response.ok()).toBe(true);
  const payload = await response.json() as { data: Array<{ arrivalAt: string; note: string | null }> };
  const arrivalAt = new Date(interval.arrivalAtIso).toISOString();
  expect(payload.data.filter((item) => item.arrivalAt === arrivalAt && item.note === note)).toHaveLength(1);
  expect(calls).toBe(2);

  await page.goBack();
  await expect(page).toHaveURL(/\/presence$/);
  await expect(page.getByLabel("备注（选填）")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "提交报备" })).toHaveCount(0);
  expect(calls).toBe(2);
});
