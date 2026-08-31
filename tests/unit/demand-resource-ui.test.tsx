import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FormalDemandList } from "@/components/demand/formal-demand-list";

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
  });

  it("fails closed to a readable label for an unknown enum", () => {
    const html = renderToStaticMarkup(<FormalDemandList admin result={result("FUTURE_STATE", "FUTURE_TYPE")} />);
    expect(html).toContain("状态待确认");
    expect(html).toContain("其他需求");
    expect(html).not.toContain("FUTURE_STATE");
  });
});
