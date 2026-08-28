import { describe, expect, it } from "vitest";
import { DEMAND_MATCH_PROMPT_V1 } from "@/ai/prompts/demand-match/v1";
import { AIService, FakeDemandMatchProvider, validateDemandMatchOutput, type DemandMatchInput } from "@/modules/ai";
import {
  deterministicRuleFallback,
  getClaimDeadline,
  getDemandClaimPeriodDays,
  isAlumniFallbackEligible,
  isResponsibleTownshipStaff,
  sortAndLimitCandidatePool,
  toSanitizedDemandMatchInput,
  type RecommendationCandidateFacts,
  type RecommendationDemandFacts,
} from "@/modules/demand";
import { parseJobPayload } from "@/modules/jobs";
import { evaluateCurrentMemberSnapshot } from "@/modules/member-foundation/current-member-eligibility";
import { resolveCapabilities } from "@/modules/permissions";

const demand: RecommendationDemandFacts = {
  demandId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  title: "智能制造产线技术升级",
  originalDescription: "寻找熟悉自动化与工业软件的人才协助技术升级",
  demandType: "TECHNICAL",
  enterpriseEvidence: { mainProducts: "工业机器人", industries: ["智能制造"] },
};

function candidate(index = 0, ruleScore = 50, withSuitability = true): RecommendationCandidateFacts {
  const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
  return {
    candidateId: id,
    name: `候选人${index}`,
    candidateKind: "CURRENT",
    profileId: id,
    professionalDirection: "工业自动化",
    industries: ["智能制造"],
    coordinatableResources: "工业软件专家",
    preferredDemandTypes: ["TECHNICAL"],
    personalIntroduction: "只包含与能力有关的公开简介",
    currentOwnedDemandCount: 0,
    recentActivity: { recentTripCount: 1, lastActivityAt: "2026-08-20T00:00:00.000Z" },
    evidence: withSuitability ? [{ key: "INDUSTRY", sourceEntityType: "MEMBER_CAPABILITY_PROFILE", sourceEntityId: id, field: "industries", snapshotValue: ["智能制造"] }] : [{ key: "CURRENT_OWNER_COUNT", sourceEntityType: "DEMAND_OWNER_HISTORY", sourceEntityId: id, field: "currentOwnedDemandCount", snapshotValue: 0 }],
    ruleScore,
  };
}

function aiInput(candidates = [candidate()]): DemandMatchInput {
  return toSanitizedDemandMatchInput(demand, candidates);
}

describe("M1-005 demand recommendation rules", () => {
  it("uses a configurable 30-day claim deadline and the zero-result fallback gate", () => {
    const publishedAt = new Date("2026-08-01T00:00:00.000Z");
    expect(getDemandClaimPeriodDays({} as NodeJS.ProcessEnv)).toBe(30);
    expect(getDemandClaimPeriodDays({ DEMAND_CLAIM_PERIOD_DAYS: "45" } as unknown as NodeJS.ProcessEnv)).toBe(45);
    expect(getClaimDeadline({ firstPublishedAt: publishedAt })?.toISOString()).toBe("2026-08-31T00:00:00.000Z");
    const base = { demand: { status: "PENDING_CLAIM", firstPublishedAt: publishedAt, currentOwnerPersonId: null }, now: new Date("2026-08-02T00:00:00.000Z") };
    expect(isAlumniFallbackEligible({ ...base, latestCurrentRun: { status: "SUCCEEDED", itemCount: 1 } })).toBe(false);
    expect(isAlumniFallbackEligible({ ...base, latestCurrentRun: { status: "SUCCEEDED", itemCount: 0 } })).toBe(true);
    expect(isAlumniFallbackEligible({ ...base, now: new Date("2026-09-01T00:00:00.000Z") })).toBe(true);
  });

  it("sorts deterministically, caps the AI pool at 20, and returns at most 3 evidence-backed fallbacks", () => {
    const pool = Array.from({ length: 25 }, (_, index) => candidate(index, index));
    const sorted = sortAndLimitCandidatePool(pool);
    expect(sorted).toHaveLength(20);
    expect(sorted[0].ruleScore).toBe(24);
    const fallback = deterministicRuleFallback(pool);
    expect(fallback).toHaveLength(3);
    expect(fallback.every((item) => item.evidence.length > 0 && !/%|百分比|匹配度\s*\d/i.test(item.reason))).toBe(true);
    expect(deterministicRuleFallback([candidate(30, 100, false)])).toEqual([]);
  });

  it("recursively redacts free-text PII only from the provider DTO", async () => {
    const phone = "13812345678";
    const identity = "32010219900101123X";
    const email = "member@example.com";
    const piiDemand: RecommendationDemandFacts = {
      ...demand,
      title: `联系人 ${phone}`,
      originalDescription: `身份证 ${identity}，邮箱 ${email}`,
      enterpriseEvidence: { mainProducts: `控制器 ${phone}`, industries: [`智能制造 ${email}`] },
    };
    const piiCandidate: RecommendationCandidateFacts = {
      ...candidate(),
      professionalDirection: `工业自动化 ${identity}`,
      industries: [`智能制造 ${email}`],
      coordinatableResources: `专家电话 ${phone}`,
      personalIntroduction: `联系 ${email}`,
      evidence: [{
        key: "INDUSTRY",
        sourceEntityType: "MEMBER_CAPABILITY_PROFILE",
        sourceEntityId: candidate().candidateId,
        field: "industries",
        snapshotValue: [`智能制造 ${phone}`, identity, email],
      }],
    };
    const persistableEvidence = structuredClone(piiCandidate.evidence);
    const provider = new FakeDemandMatchProvider([{ recommendations: [] }]);
    await new AIService(provider).rankDemandCandidates(toSanitizedDemandMatchInput(piiDemand, [piiCandidate]));
    const serialized = JSON.stringify(provider.requests);
    expect(serialized).not.toContain(phone);
    expect(serialized).not.toContain(identity);
    expect(serialized).not.toContain(email);
    expect(serialized).toContain("[REDACTED_PHONE]");
    expect(serialized).toContain("[REDACTED_ID]");
    expect(serialized).toContain("[REDACTED_EMAIL]");
    expect(serialized).not.toMatch(/手机号|reimbursement|报销|contactPhone/i);
    expect(serialized).toContain("professionalDirection");
    expect(serialized).toContain("currentOwnedDemandCount");
    expect(piiCandidate.evidence).toEqual(persistableEvidence);
    expect(JSON.stringify(piiCandidate.evidence)).toContain(phone);
    expect(JSON.stringify(piiDemand)).toContain(identity);
  });

  it("validates candidate IDs, registered evidence, uniqueness, suitability evidence, and percentage-free reasons", () => {
    const input = aiInput();
    const valid = { recommendations: [{ candidateId: input.candidates[0].candidateId, reason: "熟悉智能制造行业，可提供相关经验。", evidenceKeys: ["INDUSTRY"] }] };
    expect(validateDemandMatchOutput(input, valid)).toEqual(valid);
    expect(() => validateDemandMatchOutput(input, { recommendations: [{ ...valid.recommendations[0], candidateId: crypto.randomUUID() }] })).toThrow();
    expect(() => validateDemandMatchOutput(input, { recommendations: [{ ...valid.recommendations[0], evidenceKeys: ["RECENT_ACTIVITY"] }] })).toThrow();
    expect(() => validateDemandMatchOutput(input, { recommendations: [valid.recommendations[0], valid.recommendations[0]] })).toThrow();
    expect(() => validateDemandMatchOutput(input, { recommendations: [{ ...valid.recommendations[0], reason: "匹配度 95%" }] })).toThrow();
  });

  it("repairs invalid structured output once and reports invalid output after the repair also fails", async () => {
    const input = aiInput();
    const valid = { recommendations: [{ candidateId: input.candidates[0].candidateId, reason: "行业经验与需求事实相符。", evidenceKeys: ["INDUSTRY"] }] };
    const repairedProvider = new FakeDemandMatchProvider([{ recommendations: [{ ...valid.recommendations[0], candidateId: crypto.randomUUID() }] }, valid]);
    const repaired = await new AIService(repairedProvider).rankDemandCandidates(input);
    expect(repaired).toMatchObject({ ok: true, repaired: true });
    expect(repairedProvider.requests.map(({ attempt }) => attempt)).toEqual(["INITIAL", "REPAIR"]);
    const invalid = await new AIService(new FakeDemandMatchProvider(["not-json", "still-invalid"])).rankDemandCandidates(input);
    expect(invalid).toMatchObject({ ok: false, errorCategory: "AI_OUTPUT_INVALID" });
  });

  it("versions the committed prompt and job payload and reserves management for administrators", () => {
    expect(DEMAND_MATCH_PROMPT_V1.version).toBe("demand-match-v1");
    expect(DEMAND_MATCH_PROMPT_V1.instructions.join(" ")).toContain("at most three");
    expect(parseJobPayload("DEMAND_RECOMMENDATION_RUN", { runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })).toEqual({ runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    expect(resolveCapabilities(["ADMIN"], new Set()).has("demand.recommendation.manage")).toBe(true);
    expect(resolveCapabilities(["TOWNSHIP_STAFF"], new Set()).has("demand.recommendation.manage")).toBe(false);
  });

  it("requires both an effective township role and the responsible area for full visibility", () => {
    const actor = { effectiveRoles: ["TOWNSHIP_STAFF"], townshipAreaIds: ["area-a"] };
    expect(isResponsibleTownshipStaff(actor as never, "area-a")).toBe(true);
    expect(isResponsibleTownshipStaff({ ...actor, effectiveRoles: [] } as never, "area-a")).toBe(false);
    expect(isResponsibleTownshipStaff(actor as never, "area-b")).toBe(false);
  });

  it("reuses the same live current-member predicate used by claim", () => {
    const now = new Date("2026-08-27T00:00:00.000Z");
    const snapshot = {
      id: "person-current",
      name: "在任团员",
      personStatus: "ACTIVE",
      account: { status: "NORMAL", forcePasswordChange: false, confidentialityConfirmedAt: now },
      batchMemberships: [{ batchId: "batch-current", status: "ACTIVE", startDate: new Date("2026-01-01"), endDate: null }],
      roleAssignments: [{ roleCode: "MEMBER_CURRENT", effectiveAt: new Date("2026-01-01"), expiredAt: null }],
    };
    expect(evaluateCurrentMemberSnapshot(snapshot, "batch-current", now)).toMatchObject({ eligible: true });
    expect(evaluateCurrentMemberSnapshot({ ...snapshot, account: { ...snapshot.account, status: "DISABLED" } }, "batch-current", now)).toMatchObject({ eligible: false, reason: "ACCOUNT_INEFFECTIVE" });
    expect(evaluateCurrentMemberSnapshot({ ...snapshot, roleAssignments: [] }, "batch-current", now)).toMatchObject({ eligible: false, reason: "MEMBERSHIP_OR_ROLE_INEFFECTIVE" });
  });
});
