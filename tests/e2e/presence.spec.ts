import { expect, test, type Page } from "@playwright/test";
import { e2eUsers, seedAuthFixtures } from "./auth-fixtures";
import { futureShanghaiPresenceInterval } from "./presence-time";

declare global {
  interface Window { __presenceGpsCalls: number }
}

async function login(page: Page, phone: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("手机号").fill(phone);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}

async function apiPost(page: Page, path: string, body: unknown) {
  return page.evaluate(async ({ path, body }) => {
    const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, payload: await response.json() };
  }, { path, body });
}

test.beforeEach(async () => { await seedAuthFixtures(); });

test("MEMBER_CURRENT reports Presence, sees current list, and never requests GPS", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "__presenceGpsCalls", { value: 0, writable: true });
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition = () => { window.__presenceGpsCalls += 1; };
      navigator.geolocation.watchPosition = () => { window.__presenceGpsCalls += 1; return 1; };
    }
  });
  await login(page, e2eUsers.normal.phone, e2eUsers.normal.password);
  await page.goto("/presence/new");
  const form = page.locator("form");
  await expect(form).toHaveAttribute("aria-busy", "false");
  const interval = futureShanghaiPresenceInterval();
  const arrival = page.getByLabel("到宝时间");
  const departure = page.getByLabel("预计离宝时间");
  await arrival.fill(interval.arrivalAtLocal);
  await departure.fill(interval.expectedDepartureAtLocal);
  await expect(arrival).toHaveValue(interval.arrivalAtLocal);
  await expect(departure).toHaveValue(interval.expectedDepartureAtLocal);
  const responsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/v2/presence"
      && response.request().method() === "POST");
  await page.getByRole("button", { name: "提交报备" }).click();
  expect((await responsePromise).status()).toBe(201);
  await expect(page).toHaveURL(/\/presence$/);
  await expect(page.getByText("未来安排")).toBeVisible();

  const now = Date.now();
  const current = await apiPost(page, "/api/v2/presence", {
    arrivalAt: new Date(now - 60 * 60_000).toISOString(), expectedDepartureAt: new Date(now + 2 * 60 * 60_000).toISOString(), note: "E2E 当前在宝",
  });
  expect(current.status).toBe(201);
  await page.goto("/presence/current");
  await expect(page.getByText("E2E normal")).toBeVisible();
  expect(await page.evaluate(() => window.__presenceGpsCalls)).toBe(0);
});

test("a network interruption keeps the Presence draft and permits an explicit retry", async ({ page }) => {
  await login(page, e2eUsers.normal.phone, e2eUsers.normal.password);
  await page.goto("/presence/new");
  await expect(page.locator("form")).toHaveAttribute("aria-busy", "false");
  const interval = futureShanghaiPresenceInterval(new Date(), 7);
  const arrival = page.getByLabel("到宝时间");
  const departure = page.getByLabel("预计离宝时间");
  await arrival.fill(interval.arrivalAtLocal);
  await departure.fill(interval.expectedDepartureAtLocal);

  let attempts = 0;
  await page.route("**/api/v2/presence", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    attempts += 1;
    if (attempts === 1) return route.abort("internetdisconnected");
    return route.continue();
  });

  const submit = page.getByRole("button", { name: "提交报备" });
  await submit.click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("网络异常，已保留当前内容，请检查连接后重试");
  await expect(submit).toBeEnabled();
  await expect(arrival).toHaveValue(interval.arrivalAtLocal);
  await expect(departure).toHaveValue(interval.expectedDepartureAtLocal);

  await submit.click();
  await expect(page).toHaveURL(/\/presence$/);
  await expect(page.getByText("未来安排")).toBeVisible();
  expect(attempts).toBe(2);
});

test("platform alumni can report while ordinary users cannot browse other-person history", async ({ page }) => {
  await login(page, e2eUsers.alumni.phone, e2eUsers.alumni.password);
  const interval = futureShanghaiPresenceInterval(new Date(), 8);
  const created = await apiPost(page, "/api/v2/presence", {
    arrivalAt: interval.arrivalAtIso, expectedDepartureAt: interval.expectedDepartureAtIso, note: "E2E 往届报备",
  });
  expect(created.status).toBe(201);
  const forbidden = await page.evaluate(async () => {
    const response = await fetch("/api/v2/admin/presence/history");
    return { status: response.status, payload: await response.json() };
  });
  expect(forbidden.status).toBe(403);
  expect(forbidden.payload).toMatchObject({ error: { code: "FORBIDDEN_CAPABILITY" } });
});

test("admin views history and performs audited correction", async ({ page }) => {
  await login(page, e2eUsers.admin.phone, e2eUsers.admin.password);
  const history = await page.evaluate(async () => {
    const response = await fetch("/api/v2/admin/presence/history?keyword=E2E%20alumni");
    return { status: response.status, payload: await response.json() };
  });
  expect(history.status).toBe(200);
  const reportId = history.payload.data.items[0].id as string;
  const corrected = await apiPost(page, `/api/v2/admin/presence/${reportId}/correct`, {
    changes: { origin: "扬州" }, reason: "E2E 线下核实",
  });
  expect(corrected.status).toBe(200);
  expect(corrected.payload).toMatchObject({ data: { origin: "扬州" } });
  await page.goto("/admin/presence");
  await expect(page.getByRole("heading", { name: "来离宝管理" })).toBeVisible();
});
