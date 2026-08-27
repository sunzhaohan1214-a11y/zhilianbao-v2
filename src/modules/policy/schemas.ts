import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional();
const date = z.iso.date();
const optionalQueryString = z.preprocess((value) => value === null || value === "" ? undefined : value, z.string().optional());
const optionalInteger = (fallback: number, maximum: number) => z.preprocess(
  (value) => value === null || value === "" || value === undefined ? fallback : Number(value),
  z.number().int().min(1).max(maximum),
);

export const policyCoreSchema = z.object({
  title: text(300),
  issuingDepartment: text(300),
  publicationDate: date,
  level: text(64),
  applicationDeadline: z.union([date, z.null()]).optional(),
  tagIds: z.array(z.uuid()).max(20).default([]),
}).strict();

export const policyInterpretationSchema = z.object({
  targetAudience: text(5000),
  supportContent: text(10000),
  applicationConditions: text(10000),
  keyClauses: z.array(text(5000)).min(1).max(100),
  evidence: z.array(z.object({
    field: text(100),
    value: text(5000),
    attachmentId: z.uuid().optional(),
    page: z.number().int().positive().optional(),
    locator: optionalText(500),
  }).strict()).max(200).default([]),
}).strict();

export const createPolicySchema = policyCoreSchema.extend({
  primaryAttachmentId: z.uuid(),
  supplementaryAttachmentIds: z.array(z.uuid()).max(30).default([]),
  content: z.record(z.string(), z.unknown()).default({}),
}).strict();

export const createPolicyVersionSchema = createPolicySchema.extend({
  changeReason: text(500),
}).strict();

export const confirmPolicyInterpretationSchema = z.object({
  interpretationId: z.uuid().optional(),
  core: policyCoreSchema,
  interpretation: policyInterpretationSchema,
}).strict();

export const reasonSchema = z.object({ reason: text(500) }).strict();
export const replacementCreateSchema = z.object({ oldPolicyId: z.uuid(), reason: text(500) }).strict();
export const replacementEndSchema = z.object({ reason: text(500), restoreOldAsCurrent: z.boolean() }).strict();

export const policyListQuerySchema = z.object({
  keyword: optionalQueryString.pipe(z.string().trim().max(100).optional()),
  level: optionalQueryString.pipe(z.string().trim().max(64).optional()),
  tagId: optionalQueryString.pipe(z.uuid().optional()),
  effectStatus: optionalQueryString.pipe(z.enum(["CURRENT", "REPLACED"]).optional()),
  publicationStatus: optionalQueryString.pipe(z.enum(["DRAFT", "PUBLISHED", "WITHDRAWN"]).optional()),
  page: optionalInteger(1, 1_000_000),
  pageSize: optionalInteger(20, 100),
}).strict();

export type PolicyCoreInput = z.infer<typeof policyCoreSchema>;
export type CreatePolicyInput = z.infer<typeof createPolicySchema>;
export type PolicyInterpretationInput = z.infer<typeof policyInterpretationSchema>;
