import { z } from "zod";

const text = (max: number, min = 1) => z.string().trim().min(min).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional();

export const talentCoreSchema = z
  .object({
    name: text(80),
    scopeType: z.enum(["DOMESTIC", "OVERSEAS"]),
    organizationName: text(200),
    title: text(200),
    professionalDirection: text(1000),
    workEducationExperience: optionalText(20_000),
    representativeAchievements: optionalText(20_000),
    originalRecommenderPersonId: z.uuid().optional(),
  })
  .strict();

export const talentChangesSchema = z
  .object({
    name: text(80).optional(),
    scopeType: z.enum(["DOMESTIC", "OVERSEAS"]).optional(),
    organizationName: text(200).optional(),
    title: text(200).optional(),
    professionalDirection: text(1000).optional(),
    workEducationExperience: z.union([text(20_000), z.null()]).optional(),
    representativeAchievements: z.union([text(20_000), z.null()]).optional(),
    originalRecommenderPersonId: z.uuid().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "至少填写一项修改内容");

export const createTalentChangeRequestSchema = z.discriminatedUnion(
  "requestType",
  [
    z
      .object({
        requestType: z.literal("CREATE"),
        payload: z.object({ talent: talentCoreSchema }).strict(),
        attachmentIds: z.array(z.uuid()).max(20).default([]),
      })
      .strict(),
    z
      .object({
        requestType: z.literal("CORRECTION"),
        targetTalentId: z.uuid(),
        baseTalentVersion: z.number().int().positive(),
        payload: z
          .object({
            changes: talentChangesSchema,
            originalRecommenderChangeReason: optionalText(500),
          })
          .strict(),
        attachmentIds: z.array(z.uuid()).max(20).default([]),
      })
      .strict(),
  ],
);

export const resubmitTalentChangeRequestSchema = z
  .object({
    payload: z.union([
      z.object({ talent: talentCoreSchema }).strict(),
      z
        .object({
          changes: talentChangesSchema,
          originalRecommenderChangeReason: optionalText(500),
        })
        .strict(),
    ]),
    baseTalentVersion: z.number().int().positive().optional(),
  })
  .strict();

export const reviewTalentChangeRequestSchema = z.discriminatedUnion(
  "decision",
  [
    z
      .object({ decision: z.literal("APPROVE"), reason: optionalText(500) })
      .strict(),
    z.object({ decision: z.literal("RETURN"), reason: text(500) }).strict(),
    z.object({ decision: z.literal("CLOSE"), reason: text(500) }).strict(),
  ],
);

export const formalTalentCorrectionSchema = z
  .object({
    changes: talentChangesSchema,
    reason: text(500),
    baseVersion: z.number().int().positive().optional(),
  })
  .strict();
export const reasonSchema = z.object({ reason: text(500) }).strict();
export const changeContactPersonSchema = z
  .object({ personId: z.uuid(), reason: text(500) })
  .strict();
export const mergeTalentSchema = z
  .object({
    targetTalentId: z.uuid(),
    reason: text(500),
    confirmation: z.literal("CONFIRM"),
  })
  .strict();
export const startTalentRoundSchema = z
  .object({ areaId: z.uuid(), handlerPersonId: z.uuid().optional() })
  .strict();
export const addTalentProgressSchema = z
  .object({ content: text(2000), nextStep: optionalText(1000) })
  .strict();
export const completeTalentRoundSchema = z
  .object({ resultSummary: optionalText(2000) })
  .strict();
export const aiExtractionSchema = z.object({ attachmentId: z.uuid() }).strict();
export const confirmAIExtractionSchema = z
  .object({
    extractionId: z.uuid(),
    workEducationExperience: optionalText(20_000),
    representativeAchievements: optionalText(20_000),
  })
  .strict();

const optionalQuery = z.preprocess(
  (value) => (value === null || value === "" ? undefined : value),
  z.string().optional(),
);
const pageNumber = (fallback: number, max: number) =>
  z.preprocess(
    (value) =>
      value === null || value === "" || value === undefined
        ? fallback
        : Number(value),
    z.number().int().min(1).max(max),
  );
export const talentListQuerySchema = z
  .object({
    scopeType: optionalQuery.pipe(z.enum(["DOMESTIC", "OVERSEAS"]).optional()),
    keyword: optionalQuery.pipe(z.string().trim().max(100).optional()),
    direction: optionalQuery.pipe(z.string().trim().max(100).optional()),
    organization: optionalQuery.pipe(z.string().trim().max(100).optional()),
    title: optionalQuery.pipe(z.string().trim().max(100).optional()),
    status: optionalQuery.pipe(
      z.enum(["ACTIVE", "DISABLED", "MERGED"]).optional(),
    ),
    page: pageNumber(1, 1_000_000),
    pageSize: pageNumber(20, 100),
  })
  .strict();
export const talentRequestListQuerySchema = z
  .object({
    status: optionalQuery.pipe(
      z.enum(["PENDING_REVIEW", "APPROVED", "RETURNED", "CLOSED"]).optional(),
    ),
    requestType: optionalQuery.pipe(
      z.enum(["CREATE", "CORRECTION"]).optional(),
    ),
    page: pageNumber(1, 1_000_000),
    pageSize: pageNumber(20, 100),
  })
  .strict();

export type TalentCoreInput = z.infer<typeof talentCoreSchema>;
export type TalentChanges = z.infer<typeof talentChangesSchema>;
