import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatShanghaiDateTime } from "@/lib/presentation/date-time";
import {
  backupComplianceStatusLabel,
  businessLabel,
  policyEffectStatusLabel,
  policyPublicationStatusLabel,
  systemHealthStatusLabel,
} from "@/components/admin/business-labels";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("business-facing UI consistency", () => {
  it("uses the six real demand-lead states instead of legacy labels", () => {
    const labels = source("src/components/admin/business-labels.ts");
    expect(labels).toContain("PENDING_TOWNSHIP_VERIFY");
    expect(labels).toContain("PENDING_ENTERPRISE_LINK");
    expect(labels).toContain("NEED_MORE_INFO");
    expect(labels).not.toMatch(/UNVERIFIED|PENDING_VERIFY|VERIFIED|LINKED/);
  });

  it("keeps the mobile admin navigation touch target at least 44px", () => {
    const shell = source("src/components/admin/admin-shell.tsx");
    expect(shell).toContain("min-h-11 content-center whitespace-nowrap");
    expect(shell).not.toContain("min-h-10 whitespace-nowrap");
  });

  it("keeps each trip in one objective list group and exposes a 44px create action", () => {
    const trips = source("src/app/(mobile)/trips/page.tsx");
    expect(trips).toContain("todayIds.has(trip.id)");
    expect(trips).toContain("min-h-11 content-center rounded-xl");
  });

  it("formats business timestamps in Asia/Shanghai", () => {
    const formatted = formatShanghaiDateTime("2026-01-01T00:30:00.000Z");
    expect(formatted).toContain("2026");
    expect(formatted).toContain("1/1");
    expect(source("src/lib/presentation/date-time.ts")).toContain('timeZone: "Asia/Shanghai"');
  });

  it("maps core policy and system states to Chinese and fails soft", () => {
    expect(businessLabel(policyPublicationStatusLabel, "PUBLISHED")).toBe("已发布");
    expect(businessLabel(policyEffectStatusLabel, "CURRENT")).toBe("现行");
    expect(businessLabel(systemHealthStatusLabel, "DEGRADED")).toBe("需要关注");
    expect(businessLabel(backupComplianceStatusLabel, "FUTURE_STATE")).toBe("状态待确认");
  });

  it("does not expose engineering milestone titles on core admin entry pages", () => {
    for (const path of ["src/app/admin/demands/page.tsx", "src/app/admin/policies/page.tsx", "src/app/admin/system/page.tsx"]) {
      expect(source(path)).not.toMatch(/M1-003|M2-006|M3-007|Formal Demand|System Admin/);
    }
  });
});
