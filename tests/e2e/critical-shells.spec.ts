import { expect, test } from "@playwright/test";

test("mobile shell exposes only the approved navigation", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "首页" })).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "手机主导航" });
  await expect(navigation.getByRole("link")).toHaveCount(4);
  await expect(navigation.getByRole("link")).toHaveText(["首页", "需求", "资源", "我的"]);
});

test("admin shell is independently reachable", async ({ page }) => {
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
  expect(await ready.json()).toMatchObject({ status: "ready", database: "not-configured" });
});
