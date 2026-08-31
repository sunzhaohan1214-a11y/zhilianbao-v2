import { describe, expect, it } from "vitest";
import { adminNavigation } from "@/components/admin/admin-shell";
import { businessLabel, demandLeadStatusLabel, recordStatusLabel } from "@/components/admin/business-labels";

describe("admin UI contract", () => {
  it("keeps the approved nine navigation groups", () => {
    expect(adminNavigation.map(({ label }) => label)).toEqual([
      "工作台", "需求与成效", "资源管理", "工作动态", "事务管理", "数据与报表", "用户与组织", "智能服务", "系统管理",
    ]);
  });

  it("maps technical states to business labels and fails closed", () => {
    expect(businessLabel(demandLeadStatusLabel, "PENDING_TOWNSHIP_VERIFY")).toBe("待镇区核验");
    expect(businessLabel(recordStatusLabel, "DISABLED")).toBe("已停用");
    expect(businessLabel(recordStatusLabel, "FUTURE_STATE")).toBe("状态待确认");
  });
});
