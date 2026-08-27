import { z } from "zod";

const text = (maximum: number, minimum = 1) => z.string().trim().min(minimum).max(maximum);
const optionalText = (maximum: number) => z.union([text(maximum), z.literal("")]).optional();
const optionalDate = z.union([z.null(), z.coerce.date()]).optional();
const optionalQuery = z.preprocess((value) => value === null || value === "" ? undefined : value, z.string().optional());
const pageNumber = (fallback: number, maximum: number) => z.preprocess(
  (value) => value === null || value === "" || value === undefined ? fallback : Number(value),
  z.number().int().min(1).max(maximum),
);

export const memberListQuerySchema = z.object({
  kind: optionalQuery.pipe(z.enum(["current", "alumni"]).default("current")),
  keyword: optionalQuery.pipe(z.string().trim().max(100).optional()),
  page: pageNumber(1, 1_000_000),
  pageSize: pageNumber(20, 100),
}).strict();

export const collaborationCandidateQuerySchema = z.object({
  keyword: optionalQuery.pipe(z.string().trim().max(80).optional()),
  limit: pageNumber(20, 50),
}).strict();

export const capabilityProfileSchema = z.object({
  professionalDirection: optionalText(500),
  coordinatableResources: optionalText(5000),
  personalIntroduction: optionalText(5000),
  industryIds: z.array(z.uuid()).max(50).default([]),
  preferredDemandTypes: z.array(z.enum(["TECHNICAL", "TALENT", "PROJECT", "OTHER"])).max(4).default([]),
}).strict();

export const batchCreateSchema = z.object({
  name: text(100), year: z.number().int().min(2000).max(2200),
  startDate: z.coerce.date(), endDate: optionalDate,
}).strict().refine((value) => !value.endDate || value.endDate >= value.startDate, "结束日期不得早于开始日期");

export const batchActivationSchema = z.object({
  confirmation: z.literal("ACTIVATE"),
  expectedCurrentBatchId: z.union([z.uuid(), z.null()]),
}).strict();

export const batchCloseSchema = z.object({ reason: text(500) }).strict();

export const groupLeaderSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ASSIGN"), personId: z.uuid(), reason: text(500) }).strict(),
  z.object({ action: z.literal("REVOKE"), reason: text(500) }).strict(),
]);

const membershipFields = z.object({
  batchId: z.uuid(),
  dispatchOrganizationId: z.union([z.uuid(), z.null()]).optional(),
  postOrganizationId: z.union([z.uuid(), z.null()]).optional(),
  positionTitle: optionalText(100),
  startDate: z.coerce.date(), endDate: optionalDate,
  status: z.enum(["ACTIVE", "COMPLETED", "WITHDRAWN"]).default("ACTIVE"),
}).strict();
export const membershipSchema = membershipFields.refine((value) => !value.endDate || value.endDate >= value.startDate, "结束日期不得早于开始日期");

export const membershipUpdateSchema = membershipFields.omit({ batchId: true }).partial().strict()
  .refine((value) => Object.keys(value).length > 0, "至少填写一项修改内容")
  .refine((value) => !value.endDate || !value.startDate || value.endDate >= value.startDate, "结束日期不得早于开始日期");

export const appointmentCreateSchema = z.object({
  personId: z.uuid(), organizationId: z.uuid(), positionTitle: text(100),
  effectiveAt: z.coerce.date(), expiredAt: optionalDate, isPrimary: z.boolean().default(false),
}).strict().refine((value) => !value.expiredAt || value.expiredAt > value.effectiveAt, "任职结束时间必须晚于开始时间");

export const endRecordSchema = z.object({ expiredAt: z.coerce.date(), reason: text(500) }).strict();

export const departmentAreaRelationSchema = z.object({
  departmentOrganizationId: z.uuid(), areaId: z.uuid(), effectiveAt: z.coerce.date(), expiredAt: optionalDate,
}).strict().refine((value) => !value.expiredAt || value.expiredAt > value.effectiveAt, "关系结束时间必须晚于开始时间");

export const organizationCreateSchema = z.object({
  name: text(200),
  type: z.enum(["TOWNSHIP_ORG", "DEPARTMENT", "DISPATCH_UNIT", "POST_UNIT", "OTHER_INTERNAL"]),
  parentId: z.union([z.uuid(), z.null()]).optional(),
  phone: optionalText(30), address: optionalText(500),
}).strict();

export type CapabilityProfileInput = z.infer<typeof capabilityProfileSchema>;
export type MembershipInput = z.infer<typeof membershipSchema>;
