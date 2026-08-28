import { describe, expect, it } from "vitest";
import {
  addDemandProgressSchema,
  reviewDemandCloseSchema,
  shanghaiDateFromNaturalDayNumber,
  shanghaiNaturalDayNumber,
  transferDemandOwnerSchema,
} from "@/modules/demand";
import { outboxPayloadSchemas } from "@/modules/outbox";
import { resolveCapabilities } from "@/modules/permissions";

describe("M1-006 demand lifecycle rules", () => {
  it("uses Shanghai natural days at midnight and treats day 31 as stale", () => {
    const beforeMidnight = new Date("2026-08-31T15:59:59.999Z");
    const atMidnight = new Date("2026-08-31T16:00:00.000Z");
    expect(shanghaiNaturalDayNumber(atMidnight) - shanghaiNaturalDayNumber(beforeMidnight)).toBe(1);
    const start = new Date("2026-08-01T09:30:00.000Z");
    expect(shanghaiNaturalDayNumber(new Date("2026-08-31T15:59:59.999Z")) - shanghaiNaturalDayNumber(start)).toBe(30);
    expect(shanghaiNaturalDayNumber(new Date("2026-08-31T16:00:00.000Z")) - shanghaiNaturalDayNumber(start)).toBe(31);
    expect(shanghaiDateFromNaturalDayNumber(shanghaiNaturalDayNumber(atMidnight)).toISOString()).toBe("2026-08-31T16:00:00.000Z");
  });

  it("requires full progress, close review, and high-risk transfer payloads", () => {
    const personId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect(addDemandProgressSchema.parse({ currentProgress: "已完成需求访谈", nextStep: "安排技术对接" })).toMatchObject({ attachmentIds: [] });
    expect(() => addDemandProgressSchema.parse({ currentProgress: "", nextStep: "下一步" })).toThrow();
    expect(() => reviewDemandCloseSchema.parse({ decision: "RETURN", townshipVerificationResult: "已电话核验" })).toThrow();
    expect(() => transferDemandOwnerSchema.parse({ newOwnerPersonId: personId, reason: "工作调整", impactToken: "x".repeat(32), confirmation: "WRONG" })).toThrow();
    expect(transferDemandOwnerSchema.parse({ newOwnerPersonId: personId, reason: "工作调整", impactToken: "x".repeat(32), confirmation: "CONFIRM" })).toMatchObject({ confirmation: "CONFIRM" });
  });

  it("registers lifecycle notification payloads and keeps transfer SUPER-only", () => {
    const payload = { aggregateId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", recipientIds: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"], todoRecipientIds: [], eventKey: "event-a" };
    for (const eventType of [
      "DEMAND_PROGRESS_ADDED",
      "TEAM_COORDINATOR_STALE_REMINDER",
      "DEMAND_CLOSE_SUBMITTED",
      "DEMAND_CLOSE_RETURNED",
      "DEMAND_COMPLETED",
      "DEMAND_OWNER_EXIT_REQUESTED",
      "DEMAND_OWNER_EXIT_APPROVED",
      "DEMAND_OWNER_EXIT_REJECTED",
      "DEMAND_OWNER_TRANSFERRED",
      "DEMAND_CANCELED",
    ] as const) expect(outboxPayloadSchemas[eventType].parse(payload)).toEqual(payload);
    expect(resolveCapabilities(["SUPER_ADMIN"], new Set()).has("demand.owner.transfer")).toBe(true);
    expect(resolveCapabilities(["ADMIN"], new Set()).has("demand.owner.transfer")).toBe(false);
    expect(resolveCapabilities(["MEMBER_CURRENT"], new Set()).has("demand.owner.exit_request")).toBe(true);
    expect(resolveCapabilities(["MEMBER_ALUMNI_PLATFORM"], new Set()).has("demand.progress.add")).toBe(true);
  });
});
