import { z } from "zod";

const trimmed = (maximum: number, minimum = 1) => z.string().trim().min(minimum).max(maximum);
const nullableText = (maximum: number) => z.string().trim().max(maximum).optional();

export const enterpriseCoreSchema = z.object({
  name: trimmed(200),
  responsibleAreaId: z.uuid(),
  address: trimmed(500),
  creditCode: z.string().trim().toUpperCase().regex(/^[0-9A-Z]{15,32}$/).optional(),
  legalRepresentative: nullableText(80),
  introduction: nullableText(5000),
  mainProducts: trimmed(5000),
  qualificationsHonors: nullableText(5000),
  tagIds: z.array(z.uuid()).max(50).default([]),
}).strict();

export const enterpriseFormalChangesSchema = z.object({
  name: trimmed(200).optional(),
  responsibleAreaId: z.uuid().optional(),
  address: trimmed(500).optional(),
  creditCode: z.union([z.string().trim().toUpperCase().regex(/^[0-9A-Z]{15,32}$/), z.null()]).optional(),
  legalRepresentative: z.union([trimmed(80), z.null()]).optional(),
  introduction: z.union([trimmed(5000), z.null()]).optional(),
  mainProducts: trimmed(5000).optional(),
  qualificationsHonors: z.union([trimmed(5000), z.null()]).optional(),
  tagIds: z.array(z.uuid()).max(50).optional(),
}).strict().refine((changes) => Object.keys(changes).length > 0, "至少填写一项修改内容");

export const formalCorrectionSchema = z.object({
  changes: enterpriseFormalChangesSchema,
  reason: trimmed(500),
  baseVersion: z.number().int().positive().optional(),
}).strict();

export const reasonSchema = z.object({ reason: trimmed(500) }).strict();

export const mergeEnterpriseSchema = z.object({
  targetEnterpriseId: z.uuid(),
  reason: trimmed(500),
  confirmation: z.literal("CONFIRM"),
}).strict();

export const coordinateSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
}).strict();

export const enterpriseContactCreateSchema = z.object({
  name: trimmed(80),
  positionTitle: nullableText(100),
  phone: trimmed(30).regex(/^(?:1\d{10}|0\d{2,3}-?\d{7,8}(?:-\d{1,6})?)$/),
  setPrimary: z.boolean().default(false),
}).strict();

export const enterpriseContactUpdateSchema = z.object({
  name: trimmed(80).optional(),
  positionTitle: z.union([trimmed(100), z.null()]).optional(),
  phone: trimmed(30).regex(/^(?:1\d{10}|0\d{2,3}-?\d{7,8}(?:-\d{1,6})?)$/).optional(),
}).strict().refine((changes) => Object.keys(changes).length > 0, "至少填写一项修改内容");

export const disableContactSchema = z.object({
  reason: trimmed(500),
  replacementContactId: z.uuid().optional(),
}).strict();

const createRequestPayloadSchema = z.object({ enterprise: enterpriseCoreSchema }).strict();
const correctionRequestPayloadSchema = z.object({ changes: enterpriseFormalChangesSchema }).strict();

export const createEnterpriseChangeRequestSchema = z.discriminatedUnion("requestType", [
  z.object({
    requestType: z.literal("CREATE"),
    proposedAreaId: z.uuid(),
    payload: createRequestPayloadSchema,
  }).strict(),
  z.object({
    requestType: z.literal("CORRECTION"),
    targetEnterpriseId: z.uuid(),
    baseEnterpriseVersion: z.number().int().positive(),
    payload: correctionRequestPayloadSchema,
  }).strict(),
]);

export const resubmitEnterpriseChangeRequestSchema = z.object({
  payload: z.union([createRequestPayloadSchema, correctionRequestPayloadSchema]),
  baseEnterpriseVersion: z.number().int().positive().optional(),
}).strict();

export const reviewEnterpriseChangeRequestSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("APPROVE"), reason: nullableText(500) }).strict(),
  z.object({ decision: z.literal("RETURN"), reason: trimmed(500) }).strict(),
  z.object({ decision: z.literal("CLOSE"), reason: trimmed(500) }).strict(),
]);

const optionalQueryString = z.preprocess((value) => value === null || value === "" ? undefined : value, z.string().optional());
const optionalInteger = (fallback: number, maximum: number) => z.preprocess(
  (value) => value === null || value === "" || value === undefined ? fallback : Number(value),
  z.number().int().min(1).max(maximum),
);

export const enterpriseListQuerySchema = z.object({
  keyword: optionalQueryString.pipe(z.string().trim().max(100).optional()),
  areaId: optionalQueryString.pipe(z.uuid().optional()),
  tagId: optionalQueryString.pipe(z.uuid().optional()),
  status: optionalQueryString.pipe(z.enum(["NORMAL", "DISABLED", "MERGED"]).optional()),
  contactPhone: optionalQueryString.pipe(z.string().trim().max(30).optional()),
  page: optionalInteger(1, 1_000_000),
  pageSize: optionalInteger(20, 100),
}).strict();

export const enterpriseChangeRequestListQuerySchema = z.object({
  status: optionalQueryString.pipe(z.enum(["PENDING_REVIEW", "APPROVED", "RETURNED", "CLOSED"]).optional()),
  requestType: optionalQueryString.pipe(z.enum(["CREATE", "CORRECTION"]).optional()),
  page: optionalInteger(1, 1_000_000),
  pageSize: optionalInteger(20, 100),
}).strict();

export type EnterpriseCoreInput = z.infer<typeof enterpriseCoreSchema>;
export type EnterpriseFormalChanges = z.infer<typeof enterpriseFormalChangesSchema>;
