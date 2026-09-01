import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adminNavigation, formalDemandNavigationCapabilities } from "@/components/admin/admin-shell";
import { visibleAdminWorkbenchEntries } from "@/components/admin/admin-workbench-model";
import { businessLabel, demandLeadNextStepLabel, demandLeadStatusLabel, recordStatusLabel } from "@/components/admin/business-labels";

describe("admin UI contract", () => {
  it("keeps the approved nine navigation groups", () => {
    expect(adminNavigation.map(({ label }) => label)).toEqual([
      "工作台", "需求与成效", "资源管理", "工作动态", "事务管理", "数据与报表", "用户与组织", "智能服务", "系统管理",
    ]);
  });

  it("keeps formal-demand navigation for every legitimate lifecycle capability", () => {
    expect(formalDemandNavigationCapabilities).toEqual(expect.arrayContaining(["demand.review", "demand.close.review", "demand.owner.exit_review", "demand.owner.transfer", "demand.outcome.review"]));
  });

  it("describes only the business entries granted by the current capability", () => {
    const entries = visibleAdminWorkbenchEntries(new Set(["demand.close.review"]));
    expect(entries.map(({ title }) => title)).toEqual(["需求办结审核"]);
    expect(entries[0].description).not.toContain("主责变更");
  });

  it("maps technical states to business labels and fails closed", () => {
    expect(businessLabel(demandLeadStatusLabel, "PENDING_TOWNSHIP_VERIFY")).toBe("待镇区核验");
    expect(businessLabel(recordStatusLabel, "DISABLED")).toBe("已停用");
    expect(businessLabel(recordStatusLabel, "FUTURE_STATE")).toBe("状态待确认");
  });

  it("keeps township verification separate from enterprise linking", () => {
    expect(demandLeadNextStepLabel.PENDING_TOWNSHIP_VERIFY).toContain("转正式草稿");
    expect(demandLeadNextStepLabel.PENDING_TOWNSHIP_VERIFY).not.toContain("关联");
    expect(demandLeadNextStepLabel.PENDING_ENTERPRISE_LINK).toContain("关联已有企业");
  });

  it("provides a direct way back to the mobile workspace", () => {
    const source = readFileSync(join(process.cwd(), "src/components/admin/admin-shell.tsx"), "utf8");
    expect(source).toContain("返回手机端");
    expect(source).toContain('href="/"');
  });
});
