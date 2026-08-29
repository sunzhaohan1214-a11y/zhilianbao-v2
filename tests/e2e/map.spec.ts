import { expect, test, type Page } from "@playwright/test";
import { enterpriseE2e, e2eUsers, seedAuthFixtures } from "./auth-fixtures";
test.describe.configure({ mode: "serial" });
async function login(page: Page, user: { phone: string; password: string }) { await page.goto("/login"); await page.getByLabel("手机号").fill(user.phone); await page.getByLabel("密码", { exact: true }).fill(user.password); await Promise.all([page.waitForResponse((response) => response.url().endsWith("/api/v2/auth/login")), page.getByRole("button", { name: "登录" }).click()]); }
test.beforeEach(async () => { await seedAuthFixtures(); });

test("ordinary internal uses list-first enterprise/member maps with safe no-key degradation and no GPS", async ({ page }) => {
  const pageErrors: string[] = []; page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => { Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition() { throw new Error("GPS_PERMISSION_REQUESTED"); }, watchPosition() { throw new Error("GPS_PERMISSION_REQUESTED"); } } }); });
  await login(page, e2eUsers.normal); await page.goto("/resources/enterprises"); await expect(page.getByRole("heading", { name: "企业名录" })).toBeVisible();
  await page.getByRole("link", { name: "地图", exact: true }).click(); await expect(page.getByRole("heading", { name: "企业地图" })).toBeVisible(); await expect(page.getByTestId("map-unconfigured")).toContainText("地图服务暂未配置"); const areaLink = page.getByRole("link", { name: /安宜镇/ }); await expect(areaLink).toContainText("1");
  await areaLink.click(); await expect(page.getByText("定位待完善", { exact: true })).toBeVisible(); await expect(page.getByText("地图显示当前页企业", { exact: false })).toBeVisible(); await expect(page.getByText("第 1 / 1 页 · 共 1 家", { exact: true })).toBeVisible(); await expect(page.getByRole("link", { name: "查看全县" })).toBeVisible();
  await page.goto("/resources/enterprises"); await expect(page.getByRole("heading", { name: "企业名录" })).toBeVisible();
  await page.goto("/resources/members"); await expect(page.getByRole("heading", { name: "团员" })).toBeVisible(); await page.getByRole("link", { name: "地图", exact: true }).click(); await expect(page.getByRole("heading", { name: "团员地图" })).toBeVisible(); await expect(page.getByText("展示派出单位地域分布，不是团员实时位置。")).toBeVisible(); await page.getByLabel("派出单位").selectOption(enterpriseE2e.dispatchOrganizationId); await page.getByRole("button", { name: "搜索" }).click(); await expect(page).toHaveURL(new RegExp(`dispatchOrganizationId=${enterpriseE2e.dispatchOrganizationId}`)); await expect(page.getByLabel("派出单位")).toHaveValue(enterpriseE2e.dispatchOrganizationId); await expect(page.locator("article").getByText("E2E 派出单位", { exact: true })).toBeVisible(); await expect(page.getByText("3 人", { exact: true })).toBeVisible();
  expect(pageErrors).not.toContain("GPS_PERMISSION_REQUESTED");
  const canonical = await page.evaluate(async ({ areaId }) => Promise.all([
    fetch("/api/v2/enterprises/map-summary").then((response) => response.status),
    fetch(`/api/v2/enterprises/map-points?areaId=${areaId}&page=1&pageSize=100`).then((response) => response.status),
    fetch("/api/v2/members/map-summary?kind=current").then((response) => response.status),
    fetch("/api/v2/map/areas").then((response) => response.status),
    fetch(`/api/v2/map/boundaries/${areaId}`).then((response) => response.status),
  ]), { areaId: enterpriseE2e.areaAId }); expect(canonical).toEqual([200, 200, 200, 200, 200]);
  const forbidden = await page.evaluate(async (areaId) => (await fetch("/api/v2/admin/map/boundaries", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ areaId, geoJson: { type: "Polygon", coordinates: [[[119.3, 33.2], [119.4, 33.2], [119.4, 33.3], [119.3, 33.2]]] }, reason: "ordinary forbidden" }) })).status, enterpriseE2e.areaAId); expect(forbidden).toBe(403);
});

test("Admin creates TEST boundary versions and concurrent activation leaves exactly one current", async ({ page }) => {
  await login(page, e2eUsers.admin); await page.goto("/admin/maps"); await expect(page.getByRole("heading", { name: "边界与派出单位坐标" })).toBeVisible();
  const result = await page.evaluate(async ({ areaId }) => {
    const make = async (offset: number) => { const geoJson = { type: "Feature", properties: { name: "TEST ONLY" }, geometry: { type: "Polygon", coordinates: [[[119.3 + offset, 33.2], [119.4 + offset, 33.2], [119.4 + offset, 33.3], [119.3 + offset, 33.2]]] } }; const response = await fetch("/api/v2/admin/map/boundaries", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ areaId, geoJson, sourceFilename: "TEST_ONLY.geojson", reason: `E2E create ${offset}` }) }); return (await response.json()).data; };
    const versions = await Promise.all([make(0), make(0.01)]);
    const previews = await Promise.all(versions.map((version) => fetch(`/api/v2/admin/map/boundaries/${version.id}/activate`).then((response) => response.json()).then((payload) => payload.data)));
    const statuses = await Promise.all(versions.map((version, index) => fetch(`/api/v2/admin/map/boundaries/${version.id}/activate`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ confirmation: "ACTIVATE", confirm: true, reason: "E2E concurrent activation", expectedCurrentBoundaryId: previews[index].expectedCurrentBoundaryId, expectedTargetVersion: previews[index].expectedTargetVersion, previewToken: previews[index].previewToken }),
    }).then((response) => response.status)));
    const list = await fetch(`/api/v2/map/boundaries/${areaId}?history=1`).then((response) => response.json()); return { statuses, items: list.data.items };
  }, { areaId: enterpriseE2e.areaAId });
  expect(result.statuses.toSorted()).toEqual([200, 409]); expect(result.items).toHaveLength(2); expect(result.items.filter((item: { isCurrent: boolean }) => item.isCurrent)).toHaveLength(1);
});
