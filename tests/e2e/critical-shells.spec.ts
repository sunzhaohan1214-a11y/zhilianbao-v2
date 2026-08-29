import { expect, test } from "@playwright/test";
import { e2eUsers } from "./auth-fixtures";

async function login(page: import("@playwright/test").Page, phone: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("手机号").fill(phone);
  await page.getByLabel("密码", { exact: true }).fill(password);
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => candidate.url().endsWith("/api/v2/auth/login") && candidate.request().method() === "POST"),
    page.getByRole("button", { name: "登录" }).click(),
  ]);
  expect(response.ok()).toBe(true);
  await expect(page).not.toHaveURL(/\/login$/);
}

test("mobile shell exposes only the approved navigation", async ({ page }) => {
  await login(page, e2eUsers.normal.phone, e2eUsers.normal.password);
  await expect(page.getByRole("heading", { name: "首页" })).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "手机主导航" });
  await expect(navigation.getByRole("link")).toHaveCount(4);
  await expect(navigation.getByRole("link")).toHaveText(["首页", "需求", "资源", "我的"]);
});

test("admin shell is independently reachable behind the unified permission service", async ({ page }) => {
  await login(page, e2eUsers.admin.phone, e2eUsers.admin.password);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "管理后台基础骨架" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "手机主导航" })).toHaveCount(0);
});

test("health and readiness endpoints report their real scope", async ({ request }) => {
  const health = await request.get("/health");
  expect(health.ok()).toBe(true);
  expect(await health.json()).toMatchObject({ status: "ok" });

  const ready = await request.get("/ready");
  expect(ready.ok()).toBe(true);
  expect(await ready.json()).toMatchObject({
    status: "ready",
    checks: { application: "ok", configuration: "ok", database: "ok" },
    database: "reachable",
  });
});
