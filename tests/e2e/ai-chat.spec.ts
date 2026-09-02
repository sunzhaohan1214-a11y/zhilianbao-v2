import { expect, test, type Page } from "@playwright/test";
import { e2eUsers, enterpriseE2e, seedAuthFixtures } from "./auth-fixtures";

type ChatPayload = {
  data: {
    mode: "STRUCTURED" | "SEMANTIC" | "HYBRID";
    answer: string;
    evidence: Array<{ sourceType: string; sourceId: string; displayLabel: string }>;
    degraded: boolean;
    errorCode?: string;
  };
};

async function login(page: Page) {
  const response = await page.request.post("/api/v2/auth/login", {
    headers: { origin: "http://127.0.0.1:3000" },
    data: { phone: e2eUsers.normal.phone, password: e2eUsers.normal.password },
  });
  expect(response.ok()).toBe(true);
}

async function ask(page: Page, message: string): Promise<ChatPayload> {
  await page.getByLabel("想查询什么？").fill(message);
  const responsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/v2/ai/chat") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "查询" }).click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  return response.json() as Promise<ChatPayload>;
}

test.beforeEach(async () => {
  await seedAuthFixtures();
});

test("local ChatService exposes evidence links, refuses private queries, and degrades safely", async ({ page }) => {
  // This covers the local structured service and TEST fixture only. It does not invoke or accept a real AI provider and is not UAT sign-off.
  await login(page);
  await page.goto("/ai");

  const structured = await ask(page, "查企业");
  expect(structured.data).toMatchObject({ mode: "STRUCTURED", degraded: false });
  expect(structured.data.evidence).toEqual(expect.arrayContaining([
    expect.objectContaining({
      sourceType: "ENTERPRISE",
      sourceId: enterpriseE2e.enterpriseId,
      displayLabel: "宝应智造示范企业",
    }),
  ]));
  await expect(page.getByRole("link", { name: "宝应智造示范企业" })).toHaveAttribute(
    "href",
    `/resources/enterprises/${enterpriseE2e.enterpriseId}`,
  );

  const refused = await ask(page, "查询他人荷宝正文");
  expect(refused.data).toMatchObject({
    mode: "STRUCTURED",
    degraded: false,
    errorCode: "AI_PRIVATE_QUERY_FORBIDDEN",
    evidence: [],
  });
  await expect(page.getByText("该问题涉及专属或未发布数据，荷宝不能代为查询。")).toBeVisible();

  const fallback = await ask(page, "这个结论是真的吗");
  expect(fallback.data).toMatchObject({
    mode: "SEMANTIC",
    degraded: true,
    errorCode: "AI_SEMANTIC_PROVIDER_UNAVAILABLE",
    evidence: [],
  });
  await expect(page.getByText("当前使用安全降级路径，未调用未配置的语义模型。")).toBeVisible();
});
