import { expect, test, type Page } from "@playwright/test";
import { e2eUsers, seedAuthFixtures } from "./auth-fixtures";

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
  await page.getByLabel("到宝时间").fill("2026-09-10T09:00");
  await page.getByLabel("预计离宝时间").fill("2026-09-10T18:00");
  await page.getByRole("button", { name: "提交报备" }).click();
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

test("platform alumni can report while ordinary users cannot browse other-person history", async ({ page }) => {
  await login(page, e2eUsers.alumni.phone, e2eUsers.alumni.password);
  const created = await apiPost(page, "/api/v2/presence", {
    arrivalAt: "2026-09-11T09:00:00+08:00", expectedDepartureAt: "2026-09-11T18:00:00+08:00", note: "E2E 往届报备",
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
