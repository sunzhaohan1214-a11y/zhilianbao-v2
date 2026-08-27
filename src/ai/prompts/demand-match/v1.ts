export const DEMAND_MATCH_PROMPT_V1 = {
  version: "demand-match-v1",
  inputSchema: {
    demand: ["demandId", "title", "originalDescription", "demandType", "enterpriseEvidence"],
    candidates: ["candidateId", "professionalDirection", "industries", "coordinatableResources", "preferredDemandTypes", "personalIntroduction", "currentOwnedDemandCount", "recentActivity", "evidence"],
  },
  outputSchema: {
    recommendations: [{ candidateId: "uuid", reason: "string <= 200", evidenceKeys: ["registered evidence key"] }],
  },
  instructions: [
    "Only rank candidates supplied in the input; eligibility has already been decided by the server.",
    "Use only the registered evidence attached to that candidate and never invent experience, skills, resources, or activity.",
    "Return zero candidates when no candidate has verifiable suitability evidence.",
    "Return at most three unique candidates.",
    "Every recommendation must cite at least one registered suitability evidence key.",
    "Never return a percentage, score percentage, star rating, or claim of guaranteed suitability.",
    "Return JSON matching the output schema and no free-form wrapper text.",
  ],
  failureBehavior: "Return {\"recommendations\":[]} when evidence is insufficient. Do not guess.",
  examples: [
    {
      input: { candidateId: "11111111-1111-4111-8111-111111111111", evidenceKeys: ["PROFESSIONAL_DIRECTION"] },
      output: { recommendations: [{ candidateId: "11111111-1111-4111-8111-111111111111", reason: "专业方向与需求中的高压绝缘问题一致。", evidenceKeys: ["PROFESSIONAL_DIRECTION"] }] },
    },
    { input: { candidates: "no suitability evidence" }, output: { recommendations: [] } },
  ],
} as const;

