import { describe, expect, it } from "vitest";
import { capabilityProfileSchema } from "@/modules/member-foundation/schemas";
import { assertMembershipLimit, classifyMember, isCurrentAppointment, planBatchTransition, roleLabel } from "@/modules/member-foundation/rules";

const now = new Date("2026-08-27T00:00:00.000Z");
const effectiveRole = (roleCode: string) => ({ roleCode, effectiveAt: new Date("2026-01-01"), expiredAt: null });
const membership = (batchId: string, status = "ACTIVE") => ({ batchId, status, startDate: new Date("2026-01-01"), endDate: null });

describe("B-M2-001 member rules", () => {
  it("classifies current first and supports accountless historical alumni without duplicates", () => {
    expect(classifyMember({ memberships: [membership("current")], roles: [effectiveRole("MEMBER_CURRENT"), effectiveRole("MEMBER_ALUMNI_PLATFORM")], currentBatchId: "current", hasAccount: true, now })).toBe("current");
    expect(classifyMember({ memberships: [{ ...membership("old", "COMPLETED"), endDate: new Date("2025-12-31") }], roles: [], currentBatchId: "current", hasAccount: false, now })).toBe("alumni");
    expect(classifyMember({ memberships: [], roles: [effectiveRole("MEMBER_ALUMNI_PLATFORM")], currentBatchId: "current", hasAccount: false, now })).toBeNull();
  });

  it("whitelists only capability fields and normalized relations", () => {
    const valid = { professionalDirection: "智能制造", industryIds: [crypto.randomUUID()], preferredDemandTypes: ["TECHNICAL"] };
    expect(capabilityProfileSchema.safeParse(valid).success).toBe(true);
    expect(capabilityProfileSchema.safeParse({ ...valid, phone: "13800000000" }).success).toBe(false);
    expect(capabilityProfileSchema.safeParse({ ...valid, roleCode: "SUPER_ADMIN" }).success).toBe(false);
    expect(capabilityProfileSchema.safeParse({ ...valid, batchId: crypto.randomUUID() }).success).toBe(false);
  });

  it("caps a person at three batch memberships", () => {
    expect(() => assertMembershipLimit(2)).not.toThrow();
    expect(() => assertMembershipLimit(3)).toThrow("MEMBERSHIP_LIMIT_EXCEEDED");
  });

  it("plans an explicit batch transition and rejects closed target", () => {
    expect(planBatchTransition({ targetStatus: "PLANNED", targetIsCurrent: false, currentBatchId: "old", targetBatchId: "new" })).toEqual({ changed: true, previousCurrentBatchId: "old", nextCurrentBatchId: "new" });
    expect(() => planBatchTransition({ targetStatus: "CLOSED", targetIsCurrent: false, currentBatchId: "old", targetBatchId: "new" })).toThrow("BATCH_CLOSED_CANNOT_ACTIVATE");
  });

  it("keeps only current appointments in the directory", () => {
    expect(isCurrentAppointment({ effectiveAt: new Date("2026-01-01"), expiredAt: null }, now)).toBe(true);
    expect(isCurrentAppointment({ effectiveAt: new Date("2026-01-01"), expiredAt: new Date("2026-08-26") }, now)).toBe(false);
  });

  it("keeps MINISTER and GROUP_LEADER labels separate", () => {
    expect(roleLabel("MINISTER")).toBe("部长");
    expect(roleLabel("GROUP_LEADER")).toBe("团长");
    expect(roleLabel("MINISTER")).not.toBe(roleLabel("GROUP_LEADER"));
  });
});
