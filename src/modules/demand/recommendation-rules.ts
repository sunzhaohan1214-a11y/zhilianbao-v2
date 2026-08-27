import type { DemandRecommendationCandidateKind, DemandRecommendationSource } from "@/generated/prisma/client";
import type { DemandMatchEvidence, DemandMatchInput } from "@/modules/ai";

export const DEMAND_MATCH_RULES_VERSION = "demand-match-rules-v1";
export const MAX_DEMAND_MATCH_CANDIDATES = 20;
export const MAX_DEMAND_RECOMMENDATIONS = 3;

export type RecommendationDemandFacts = DemandMatchInput["demand"];

export type RecommendationCandidateFacts = Omit<DemandMatchInput["candidates"][number], "evidence"> & {
  name: string;
  candidateKind: DemandRecommendationCandidateKind;
  profileId: string | null;
  evidence: DemandMatchEvidence[];
  ruleScore: number;
};

export type PersistableRecommendation = {
  personId: string;
  candidateKind: DemandRecommendationCandidateKind;
  source: DemandRecommendationSource;
  reason: string;
  evidence: DemandMatchEvidence[];
};

const SUITABILITY_KEYS = new Set(["PREFERRED_DEMAND_TYPE", "INDUSTRY", "PROFESSIONAL_DIRECTION", "COORDINATABLE_RESOURCES"]);

function normalized(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/[\s\p{P}\p{S}]+/gu, "");
}

function fragments(value: string): string[] {
  const pieces = value.split(/[\s,，、;；。.!！?？:：/\\|()（）\[\]【】]+/u)
    .map(normalized)
    .filter((item) => item.length >= 2);
  const compact = normalized(value);
  if (compact.length >= 2) pieces.push(compact);
  for (let index = 0; index + 1 < compact.length; index += 1) pieces.push(compact.slice(index, index + 2));
  return [...new Set(pieces)];
}

export function hasTextualEvidence(profileValue: string | null, demandText: string): boolean {
  if (!profileValue) return false;
  const demand = normalized(demandText);
  const profile = normalized(profileValue);
  if (!profile || !demand) return false;
  if (profile.length >= 2 && (demand.includes(profile) || profile.includes(demand))) return true;
  const profileFragments = fragments(profileValue);
  const demandFragments = new Set(fragments(demandText));
  return profileFragments.filter((item) => demandFragments.has(item)).length >= 2;
}

export function buildCandidateEvidence(input: {
  candidate: Omit<RecommendationCandidateFacts, "evidence" | "ruleScore">;
  demand: RecommendationDemandFacts;
}): { evidence: DemandMatchEvidence[]; ruleScore: number } {
  const { candidate, demand } = input;
  const evidence: DemandMatchEvidence[] = [];
  const demandText = [demand.title, demand.originalDescription, demand.enterpriseEvidence.mainProducts, ...demand.enterpriseEvidence.industries].join("\n");
  const sourceEntityId = candidate.profileId ?? candidate.candidateId;
  let ruleScore = 0;

  if (candidate.preferredDemandTypes.includes(demand.demandType)) {
    evidence.push({ key: "PREFERRED_DEMAND_TYPE", sourceEntityType: "MEMBER_CAPABILITY_PROFILE", sourceEntityId, field: "preferredDemandTypes", snapshotValue: [...candidate.preferredDemandTypes] });
    ruleScore += 40;
  }
  const matchedIndustries = candidate.industries.filter((industry) => {
    const industryValue = normalized(industry);
    return demand.enterpriseEvidence.industries.some((value) => normalized(value) === industryValue) || normalized(demandText).includes(industryValue);
  });
  if (matchedIndustries.length > 0) {
    evidence.push({ key: "INDUSTRY", sourceEntityType: "MEMBER_CAPABILITY_PROFILE", sourceEntityId, field: "industries", snapshotValue: matchedIndustries });
    ruleScore += 30;
  }
  if (hasTextualEvidence(candidate.professionalDirection, demandText)) {
    evidence.push({ key: "PROFESSIONAL_DIRECTION", sourceEntityType: "MEMBER_CAPABILITY_PROFILE", sourceEntityId, field: "professionalDirection", snapshotValue: candidate.professionalDirection });
    ruleScore += 25;
  }
  if (hasTextualEvidence(candidate.coordinatableResources, demandText)) {
    evidence.push({ key: "COORDINATABLE_RESOURCES", sourceEntityType: "MEMBER_CAPABILITY_PROFILE", sourceEntityId, field: "coordinatableResources", snapshotValue: candidate.coordinatableResources });
    ruleScore += 20;
  }
  evidence.push({ key: "CURRENT_OWNER_COUNT", sourceEntityType: "DEMAND_OWNER_HISTORY", sourceEntityId: candidate.candidateId, field: "currentOwnedDemandCount", snapshotValue: candidate.currentOwnedDemandCount });
  if (candidate.currentOwnedDemandCount > 0) ruleScore -= Math.min(candidate.currentOwnedDemandCount * 8, 32);
  if (candidate.recentActivity.recentTripCount > 0 || candidate.recentActivity.lastActivityAt) {
    evidence.push({ key: "RECENT_ACTIVITY", sourceEntityType: "TRIP_PARTICIPANT", sourceEntityId: candidate.candidateId, field: "recentActivity", snapshotValue: [String(candidate.recentActivity.recentTripCount), candidate.recentActivity.lastActivityAt ?? ""] });
    ruleScore += Math.min(candidate.recentActivity.recentTripCount, 3) * 2 + (candidate.recentActivity.lastActivityAt ? 1 : 0);
  }
  return { evidence, ruleScore };
}

export function sortAndLimitCandidatePool(candidates: readonly RecommendationCandidateFacts[]): RecommendationCandidateFacts[] {
  return sortCandidatePool(candidates).slice(0, MAX_DEMAND_MATCH_CANDIDATES);
}

export function sortCandidatePool(candidates: readonly RecommendationCandidateFacts[]): RecommendationCandidateFacts[] {
  return [...candidates].sort((left, right) => right.ruleScore - left.ruleScore || left.candidateId.localeCompare(right.candidateId));
}

export function hasSuitabilityEvidence(candidate: Pick<RecommendationCandidateFacts, "evidence">): boolean {
  return candidate.evidence.some(({ key }) => SUITABILITY_KEYS.has(key));
}

function ruleReason(candidate: RecommendationCandidateFacts): string {
  const labels: Record<string, string> = {
    PREFERRED_DEMAND_TYPE: "意向需求类型一致",
    INDUSTRY: "熟悉相关行业",
    PROFESSIONAL_DIRECTION: "专业方向与需求相符",
    COORDINATABLE_RESOURCES: "可协调资源与需求相关",
  };
  const matches = candidate.evidence.flatMap(({ key }) => labels[key] ? [labels[key]] : []).slice(0, 2);
  return matches.length > 0 ? `${matches.join("，")}。` : "未查询到可验证的适配依据。";
}

export function deterministicRuleFallback(candidates: readonly RecommendationCandidateFacts[]): PersistableRecommendation[] {
  return sortAndLimitCandidatePool(candidates)
    .filter(hasSuitabilityEvidence)
    .slice(0, MAX_DEMAND_RECOMMENDATIONS)
    .map((candidate) => ({
      personId: candidate.candidateId,
      candidateKind: candidate.candidateKind,
      source: "RULE_FALLBACK",
      reason: ruleReason(candidate),
      evidence: candidate.evidence,
    }));
}

export function toSanitizedDemandMatchInput(
  demand: RecommendationDemandFacts,
  candidates: readonly RecommendationCandidateFacts[],
): DemandMatchInput {
  return {
    demand: structuredClone(demand),
    candidates: candidates.map(({ candidateId, professionalDirection, industries, coordinatableResources, preferredDemandTypes, personalIntroduction, currentOwnedDemandCount, recentActivity, evidence }) => ({
      candidateId,
      professionalDirection,
      industries: [...industries],
      coordinatableResources,
      preferredDemandTypes: [...preferredDemandTypes],
      personalIntroduction: personalIntroduction?.slice(0, 500) ?? null,
      currentOwnedDemandCount,
      recentActivity: { ...recentActivity },
      evidence: structuredClone(evidence),
    })),
  };
}
