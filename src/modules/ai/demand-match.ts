import { z } from "zod";

export const DEMAND_EVIDENCE_KEYS = [
  "PREFERRED_DEMAND_TYPE",
  "INDUSTRY",
  "PROFESSIONAL_DIRECTION",
  "COORDINATABLE_RESOURCES",
  "CURRENT_OWNER_COUNT",
  "RECENT_ACTIVITY",
] as const;

export type DemandEvidenceKey = (typeof DEMAND_EVIDENCE_KEYS)[number];

export type DemandMatchEvidence = {
  key: DemandEvidenceKey;
  sourceEntityType: "MEMBER_CAPABILITY_PROFILE" | "DEMAND_OWNER_HISTORY" | "TRIP_PARTICIPANT";
  sourceEntityId: string;
  field: string;
  snapshotValue: string | number | string[] | null;
};

export type DemandMatchCandidateInput = {
  candidateId: string;
  professionalDirection: string | null;
  industries: string[];
  coordinatableResources: string | null;
  preferredDemandTypes: string[];
  personalIntroduction: string | null;
  currentOwnedDemandCount: number;
  recentActivity: { recentTripCount: number; lastActivityAt: string | null };
  evidence: DemandMatchEvidence[];
};

export type DemandMatchInput = {
  demand: {
    demandId: string;
    title: string;
    originalDescription: string;
    demandType: string;
    enterpriseEvidence: { mainProducts: string; industries: string[] };
  };
  candidates: DemandMatchCandidateInput[];
};

const recommendationSchema = z.object({
  candidateId: z.uuid(),
  reason: z.string().trim().min(4).max(200).refine(
    (value) => !/(?:\d+(?:\.\d+)?\s*%|匹配度\s*\d|百分比)/i.test(value),
    "recommendation reason must not contain a percentage",
  ),
  evidenceKeys: z.array(z.enum(DEMAND_EVIDENCE_KEYS)).min(1).max(6),
}).strict();

export const demandMatchOutputSchema = z.object({
  recommendations: z.array(recommendationSchema).max(3),
}).strict().superRefine((value, context) => {
  const ids = value.recommendations.map(({ candidateId }) => candidateId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", path: ["recommendations"], message: "candidateId must be unique" });
  }
});

export type DemandMatchOutput = z.infer<typeof demandMatchOutputSchema>;

const SUITABILITY_KEYS = new Set<DemandEvidenceKey>([
  "PREFERRED_DEMAND_TYPE",
  "INDUSTRY",
  "PROFESSIONAL_DIRECTION",
  "COORDINATABLE_RESOURCES",
]);

export function validateDemandMatchOutput(input: DemandMatchInput, output: unknown): DemandMatchOutput {
  const parsed = demandMatchOutputSchema.parse(output);
  const candidates = new Map(input.candidates.map((candidate) => [candidate.candidateId, candidate]));
  for (const recommendation of parsed.recommendations) {
    const candidate = candidates.get(recommendation.candidateId);
    if (!candidate) throw new z.ZodError([{ code: "custom", path: ["recommendations"], message: "unknown candidateId" }]);
    const registered = new Set(candidate.evidence.map(({ key }) => key));
    if (recommendation.evidenceKeys.some((key) => !registered.has(key))) {
      throw new z.ZodError([{ code: "custom", path: ["recommendations"], message: "unknown evidence key" }]);
    }
    if (!recommendation.evidenceKeys.some((key) => SUITABILITY_KEYS.has(key))) {
      throw new z.ZodError([{ code: "custom", path: ["recommendations"], message: "suitability evidence is required" }]);
    }
  }
  return parsed;
}

export type DemandMatchProviderRequest = {
  promptVersion: string;
  input: DemandMatchInput;
  attempt: "INITIAL" | "REPAIR";
  validationIssue?: string;
};

export interface DemandMatchProvider {
  readonly provider: string;
  readonly model: string;
  rank(request: DemandMatchProviderRequest): Promise<unknown>;
}

