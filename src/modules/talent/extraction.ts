import { z } from "zod";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const talentExtractionCandidateSchema = z
  .object({
    workEducationExperience: z.string().max(20_000).optional(),
    representativeAchievements: z.string().max(20_000).optional(),
    structured: z
      .object({
        experiences: z.array(jsonValueSchema).optional(),
        projects: z.array(jsonValueSchema).optional(),
        patents: z.array(jsonValueSchema).optional(),
        papers: z.array(jsonValueSchema).optional(),
        awards: z.array(jsonValueSchema).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const talentExtractionEvidenceSchema = z
  .object({
    attachmentId: z.uuid(),
    page: z.number().int().positive().optional(),
    locator: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

const forbiddenExactKeys = new Set(["tel"]);
const forbiddenKeyFragments = [
  "phone",
  "mobile",
  "telephone",
  "email",
  "wechat",
  "weixin",
  "idcard",
  "address",
  "微信",
  "身份证",
  "住址",
];

function normalizeKey(key: string) {
  return key.trim().toLowerCase().replace(/[\s_-]/g, "");
}

function containsForbiddenKey(value: JsonValue): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenKey);
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => {
    const normalized = normalizeKey(key);
    return (
      forbiddenExactKeys.has(normalized) ||
      forbiddenKeyFragments.some((fragment) => normalized.includes(fragment)) ||
      containsForbiddenKey(child)
    );
  });
}

export class TalentAIOutputUnsafeError extends Error {
  constructor() {
    super("TALENT_AI_OUTPUT_UNSAFE");
  }
}

export function parseTalentExtractionOutput(
  output: { candidate: unknown; evidence: unknown },
  expectedAttachmentId: string,
) {
  const candidate = talentExtractionCandidateSchema.safeParse(output.candidate);
  const evidence = talentExtractionEvidenceSchema.safeParse(output.evidence);
  if (
    !candidate.success ||
    !evidence.success ||
    evidence.data.attachmentId !== expectedAttachmentId ||
    containsForbiddenKey(candidate.data as JsonValue)
  )
    throw new TalentAIOutputUnsafeError();
  return { candidate: candidate.data, evidence: evidence.data };
}

export type TalentExtractionCandidate = z.infer<
  typeof talentExtractionCandidateSchema
>;
export interface TalentExtractionAdapter {
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  extract(input: {
    attachmentId: string;
  }): Promise<{ candidate: unknown; evidence: unknown }>;
}
export class UnavailableTalentExtractionAdapter implements TalentExtractionAdapter {
  readonly provider = "unavailable";
  readonly model = "unavailable";
  readonly promptVersion = "talent-v1";
  async extract(): Promise<never> {
    throw new Error("TALENT_AI_EXTRACTION_UNAVAILABLE");
  }
}
export class FakeTalentExtractionAdapter implements TalentExtractionAdapter {
  readonly provider = "fake";
  readonly model = "fake-talent-extractor";
  readonly promptVersion = "talent-v1";
  async extract(input: { attachmentId: string }) {
    return {
      candidate: {
        workEducationExperience: "测试提取的工作与教育经历",
        representativeAchievements: "测试提取的代表性成果",
        structured: {
          experiences: [],
          projects: [],
          patents: [],
          papers: [],
          awards: [],
        },
      },
      evidence: { attachmentId: input.attachmentId },
    };
  }
}
