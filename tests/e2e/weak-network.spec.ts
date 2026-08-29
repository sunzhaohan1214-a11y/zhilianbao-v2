import { expect, test, type Page } from "@playwright/test";
import { e2eUsers } from "./auth-fixtures";

async function login(page: Page) {
  const response = await page.request.post("/api/v2/auth/login", {
    headers: { origin: "http://127.0.0.1:3000" },
    data: { phone: e2eUsers.normal.phone, password: e2eUsers.normal.password },
  });
  expect(response.ok()).toBe(true);
}

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
  await expect(page.getByRole("alert")).toContainText("网络暂不可用");
  expect(calls).toBe(1);
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByText("已安全重试")).toBeVisible();
  expect(calls).toBe(2);
});
