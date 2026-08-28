import { describe, expect, it } from "vitest";
import {
  createOutcomeRoundSchema,
  dueScheduledAt,
  isDateDue,
  outcomePlanSchema,
  reviewDemandCloseSchema,
  shanghaiDateString,
} from "@/modules/demand";
import { jobPayloadSchemas } from "@/modules/jobs/job-types";
import { outboxPayloadSchemas } from "@/modules/outbox";
import { resolveCapabilities } from "@/modules/permissions";

describe("A-M1-007 outcome contracts", () => {
  it("locks plan shapes and completion review requirements", () => {
    expect(outcomePlanSchema.parse({ trackingMode: "NONE" })).toEqual({ trackingMode: "NONE" });
    expect(() => outcomePlanSchema.parse({ trackingMode: "NONE", firstTrackingDate: "2026-10-01" })).toThrow();
    expect(() => outcomePlanSchema.parse({ trackingMode: "TRACKING" })).toThrow();
    expect(() => outcomePlanSchema.parse({ trackingMode: "TRACKING", firstTrackingDate: "2026-02-31" })).toThrow();
    expect(outcomePlanSchema.parse({ trackingMode: "TRACKING", firstTrackingDate: "2026-10-01" })).toMatchObject({ trackingMode: "TRACKING" });
    expect(() => reviewDemandCloseSchema.parse({ decision: "APPROVE", townshipVerificationResult: "已核实" })).toThrow();
    expect(reviewDemandCloseSchema.parse({ decision: "APPROVE", townshipVerificationResult: "已核实", outcomePlan: { trackingMode: "NONE" } })).toMatchObject({ outcomePlan: { trackingMode: "NONE" } });
    expect(() => reviewDemandCloseSchema.parse({ decision: "RETURN", townshipVerificationResult: "需补充", reason: "材料不足", outcomePlan: { trackingMode: "NONE" } })).toThrow();
  });

  it("accepts zero increments with qualitative facts but rejects empty, negative, cumulative, and invalid scheduling", () => {
    const base = {
      trackingDate: "2026-10-01",
      qualitativeResult: "已建立联合验证机制",
      endTracking: false,
      nextTrackingDate: "2026-11-01",
    };
    expect(createOutcomeRoundSchema.parse(base)).toMatchObject({ contractAmountIncrement: "0", talentIntroducedIncrement: 0 });
    expect(() => createOutcomeRoundSchema.parse({ trackingDate: "2026-10-01", endTracking: true })).toThrow();
    expect(() => createOutcomeRoundSchema.parse({ ...base, contractAmountIncrement: "-1" })).toThrow();
    expect(() => createOutcomeRoundSchema.parse({ ...base, totalContractAmount: "1" })).toThrow();
    expect(() => createOutcomeRoundSchema.parse({ ...base, nextTrackingDate: "2026-10-01" })).toThrow();
    expect(() => createOutcomeRoundSchema.parse({ ...base, endTracking: true })).toThrow();
    expect(createOutcomeRoundSchema.parse({ ...base, endTracking: true, nextTrackingDate: null })).toMatchObject({ endTracking: true });
  });

  it("uses Shanghai date-only boundaries and schedules midnight as UTC previous-day 16:00", () => {
    expect(shanghaiDateString(new Date("2026-09-30T15:59:59.999Z"))).toBe("2026-09-30");
    expect(shanghaiDateString(new Date("2026-09-30T16:00:00.000Z"))).toBe("2026-10-01");
    expect(dueScheduledAt("2026-10-01", new Date("2026-09-01T00:00:00Z")).toISOString()).toBe("2026-09-30T16:00:00.000Z");
    expect(isDateDue("2026-10-01", new Date("2026-09-30T15:59:59.999Z"))).toBe(false);
    expect(isDateDue("2026-10-01", new Date("2026-09-30T16:00:00.000Z"))).toBe(true);
  });

  it("registers due payloads, Outcome events, and least-privilege capabilities", () => {
    const planId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect(jobPayloadSchemas.DEMAND_OUTCOME_DUE.parse({ planId, dueVersion: 2, dueDate: "2026-10-01", eventKey: "outcome-due" })).toMatchObject({ dueVersion: 2 });
    const payload = { aggregateId: planId, recipientIds: [], todoRecipientIds: [], eventKey: "event" };
    for (const event of ["OUTCOME_TRACKING_DUE", "OUTCOME_SUBMITTED", "OUTCOME_RETURNED", "OUTCOME_APPROVED_CONTINUE", "OUTCOME_TRACKING_ENDED"] as const) {
      expect(outboxPayloadSchemas[event].parse(payload)).toEqual(payload);
    }
    expect(resolveCapabilities(["TOWNSHIP_STAFF"], new Set()).has("demand.outcome.fill")).toBe(true);
    expect(resolveCapabilities(["ADMIN"], new Set()).has("demand.outcome.fill")).toBe(false);
    expect(resolveCapabilities(["ADMIN"], new Set()).has("demand.outcome.review")).toBe(true);
    for (const role of ["MEMBER_CURRENT", "MEMBER_ALUMNI_PLATFORM", "GROUP_LEADER", "MINISTER", "DEPARTMENT_STAFF"] as const) {
      expect(resolveCapabilities([role], new Set()).has("demand.outcome.fill")).toBe(false);
    }
  });
});
