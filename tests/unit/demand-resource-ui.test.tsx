import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FormalDemandList } from "@/components/demand/formal-demand-list";
import { detailNextStep, listNextStep } from "@/components/demand/demand-next-step";

function result(status: string, demandType = "TECHNICAL") {
  return {
    items: [{
      id: "demand-1",
      businessNo: "XQ-2026-001",
      title: "关键设备技术攻关",
      status,
      demandType,
      enterprise: { name: "示例企业" },
      responsibleArea: { name: "开发区" },
      currentOwner: null,
    }],
  } as never;
}

describe("demand and resource UI", () => {
  it("renders business-facing demand status and type labels", () => {
    const html = renderToStaticMarkup(<FormalDemandList result={result("PENDING_CLAIM")} />);
    expect(html).toContain("待对接");
    expect(html).not.toContain("PENDING_CLAIM");
    expect(html).not.toContain("TECHNICAL");
    expect(html).toContain("等待符合条件的在任团员认领");
  });

  it("fails closed to a readable label for an unknown enum", () => {
    const html = renderToStaticMarkup(<FormalDemandList admin result={result("FUTURE_STATE", "FUTURE_TYPE")} />);
    expect(html).toContain("状态待确认");
    expect(html).toContain("其他需求");
    expect(html).not.toContain("FUTURE_STATE");
  });

  it("describes objective list next steps without promising permission", () => {
    expect(listNextStep("PENDING_REVIEW")).toBe("等待管理员审核");
    expect(listNextStep("RETURNED")).toContain("按退回意见修改");
    expect(listNextStep("FUTURE_STATE")).toBe("打开详情确认当前下一步");
  });

  it("prioritizes the detail next step by state and existing permissions", () => {
    expect(detailNextStep({ status: "PENDING_REVIEW", canEdit: false, canSubmit: false, canReview: true, canDirectPublish: false, canClaim: false })).toContain("决定通过发布或退回修改");
    expect(detailNextStep({ status: "PENDING_CLAIM", canEdit: false, canSubmit: false, canReview: false, canDirectPublish: false, canClaim: false })).toContain("等待符合条件");
    expect(detailNextStep({ status: "PENDING_CLOSE_REVIEW", canEdit: false, canSubmit: false, canReview: false, canDirectPublish: false, canClaim: false, lifecycle: { permissions: { canReviewClose: true } } })).toContain("完成办结审核");
    expect(detailNextStep({ status: "COMPLETED", canEdit: false, canSubmit: false, canReview: false, canDirectPublish: false, canClaim: false, outcomes: { permissions: { canCreateRound: true } } })).toContain("填写本轮新增成效");
  });
});
