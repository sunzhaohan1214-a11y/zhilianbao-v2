import { z } from "zod";
import { outcomePlanSchema } from "./outcome-schemas";

const trimmed = (maximum: number, minimum = 1) => z.string().trim().min(minimum).max(maximum);
const optionalTrimmed = (maximum: number) => z.string().trim().max(maximum).optional();
const plainText = (maximum: number, minimum = 1) => trimmed(maximum, minimum).refine(
  (value) => !/[<>]/.test(value),
  "不允许提交 HTML",
);
const optionalPlainText = (maximum: number) => optionalTrimmed(maximum).refine(
  (value) => value === undefined || !/[<>]/.test(value),
  "不允许提交 HTML",
);
const contactPhone = trimmed(30).regex(/^(?:1\d{10}|0\d{2,3}-?\d{7,8}(?:-\d{1,6})?)$/);
const attachmentIds = z.array(z.uuid()).max(10).default([]);

export const publicAttachmentReferenceSchema = z.object({
  attachmentId: z.uuid(),
  uploadToken: trimmed(200, 32),
}).strict();

export const publicDemandLeadSchema = z.object({
  responsibleAreaId: z.uuid(),
  enterpriseId: z.uuid().optional(),
  enterpriseName: plainText(200),
  contactName: plainText(80),
  contactPhone,
  title: plainText(200),
  description: plainText(5000),
  truthConfirmed: z.literal(true),
  contactConsent: z.literal(true),
  formStartedAt: z.iso.datetime(),
  website: z.literal("").default(""),
  attachments: z.array(publicAttachmentReferenceSchema).max(10).default([]),
}).strict();

export const createOtherDemandLeadSchema = z.object({
  responsibleAreaId: z.uuid(),
  enterpriseId: z.uuid().optional(),
  rawEnterpriseName: optionalPlainText(200),
  rawContactName: optionalPlainText(80),
  rawContactPhone: contactPhone.optional(),
  rawTitle: plainText(200),
  rawContent: plainText(5000),
  sourceChannel: optionalPlainText(100),
  sourceAt: z.iso.datetime().optional(),
  attachmentIds,
}).strict().refine((value) => Boolean(value.enterpriseId || value.rawEnterpriseName), {
  message: "企业或原始企业名称至少填写一项",
  path: ["rawEnterpriseName"],
});

export const memberVisitDemandLeadSchema = z.object({
  responsibleAreaId: z.uuid(),
  enterpriseId: z.uuid().optional(),
  rawEnterpriseName: optionalPlainText(200),
  rawContactName: optionalPlainText(80),
  rawContactPhone: contactPhone.optional(),
  rawTitle: plainText(200),
  rawContent: plainText(5000),
  sourceChannel: optionalPlainText(100),
  sourceAt: z.iso.datetime(),
  tripId: z.uuid().optional(),
  visitId: z.uuid().optional(),
  attachmentIds,
}).strict().refine((value) => Boolean(value.enterpriseId || value.rawEnterpriseName), {
  message: "企业或原始企业名称至少填写一项",
  path: ["rawEnterpriseName"],
});

const supplementFields = {
  note: optionalPlainText(2000),
  verifiedTitle: optionalPlainText(200),
  verifiedDescription: optionalPlainText(5000),
  demandType: z.enum(["TECHNICAL", "TALENT", "PROJECT", "OTHER"]).optional(),
  urgency: z.enum(["NORMAL", "URGENT"]).optional(),
  selectedContactId: z.uuid().optional(),
};

export const addDemandLeadInfoSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("REQUEST_MORE_INFO"), note: plainText(2000) }).strict(),
  z.object({ action: z.literal("ADD_SUPPLEMENT"), ...supplementFields }).strict().refine(
    (value) => Object.entries(value).some(([key, item]) => key !== "action" && item !== undefined && item !== ""),
    "至少填写一项补充信息",
  ),
]);

export const linkDemandLeadEnterpriseSchema = z.object({ enterpriseId: z.uuid() }).strict();

export const mergeDemandLeadSchema = z.object({
  targetLeadId: z.uuid(),
  reason: plainText(500),
  confirmation: z.literal("CONFIRM"),
}).strict();

export const closeDemandLeadSchema = z.object({ reason: plainText(500) }).strict();

export const restoreDemandLeadSchema = z.object({
  reason: plainText(500),
  confirmation: z.literal("CONFIRM"),
}).strict();

export const convertDemandLeadSchema = z.object({
  selectedContactId: z.uuid(),
  title: plainText(200),
  originalDescription: plainText(5000),
  demandType: z.enum(["TECHNICAL", "TALENT", "PROJECT", "OTHER"]),
  urgency: z.enum(["NORMAL", "URGENT"]).default("NORMAL"),
  internalNote: optionalPlainText(2000),
  confirmation: z.literal("CONFIRM"),
}).strict();

const optionalQueryString = z.preprocess(
  (value) => value === null || value === "" ? undefined : value,
  z.string().optional(),
);
const optionalInteger = (fallback: number, maximum: number) => z.preprocess(
  (value) => value === null || value === "" || value === undefined ? fallback : Number(value),
  z.number().int().min(1).max(maximum),
);

export const demandLeadListQuerySchema = z.object({
  status: optionalQueryString.pipe(z.enum([
    "PENDING_TOWNSHIP_VERIFY",
    "PENDING_ENTERPRISE_LINK",
    "NEED_MORE_INFO",
    "MERGED",
    "CLOSED",
    "CONVERTED",
  ]).optional()),
  sourceType: optionalQueryString.pipe(z.enum(["ENTERPRISE_PUBLIC", "MEMBER_VISIT", "OTHER"]).optional()),
  areaId: optionalQueryString.pipe(z.uuid().optional()),
  keyword: optionalQueryString.pipe(z.string().trim().max(100).optional()),
  excludeId: optionalQueryString.pipe(z.uuid().optional()),
  actionableOnly: z.preprocess(
    (value) => value === "true" ? true : value === "false" || value === undefined ? false : value,
    z.boolean(),
  ),
  page: optionalInteger(1, 1_000_000),
  pageSize: optionalInteger(20, 100),
}).strict();

export const idempotencyKeySchema = trimmed(128, 8).regex(/^[A-Za-z0-9._:-]+$/);

const demandType = z.enum(["TECHNICAL", "TALENT", "PROJECT", "OTHER"]);
const demandUrgency = z.enum(["NORMAL", "URGENT"]);
export const directDemandSourceTypeSchema = z.enum(["TOWNSHIP_DIRECT", "ADMIN_DIRECT"]);

export const createFormalDemandSchema = z.object({
  sourceType: directDemandSourceTypeSchema,
  enterpriseId: z.uuid(),
  selectedContactId: z.uuid(),
  title: plainText(200),
  originalDescription: plainText(5000),
  demandType,
  urgency: demandUrgency.default("NORMAL"),
  responsibleAreaId: z.uuid(),
  internalNote: optionalPlainText(2000),
  attachmentIds,
}).strict();

export const updateDemandDraftSchema = z.object({
  enterpriseId: z.uuid().optional(),
  selectedContactId: z.uuid().optional(),
  title: plainText(200).optional(),
  originalDescription: plainText(5000).optional(),
  demandType: demandType.optional(),
  urgency: demandUrgency.optional(),
  responsibleAreaId: z.uuid().optional(),
  internalNote: z.union([plainText(2000), z.literal(""), z.null()]).optional(),
  attachmentIds: z.array(z.uuid()).max(10).optional(),
}).strict().refine((value) => Object.values(value).some((item) => item !== undefined), {
  message: "至少填写一项草稿修改",
});

export const submitDemandReviewSchema = z.object({}).strict();

export const reviewDemandSchema = z.object({
  decision: z.enum(["APPROVE", "RETURN"]),
  reason: optionalPlainText(500),
  demandType: demandType.optional(),
  urgency: demandUrgency.optional(),
}).strict().superRefine((value, context) => {
  if (value.decision === "RETURN" && !value.reason) {
    context.addIssue({ code: "custom", path: ["reason"], message: "退回时必须填写原因" });
  }
});

export const directPublishDemandSchema = z.object({}).strict();
export const claimDemandSchema = z.object({}).strict();
export const applyDemandCollaborationSchema = z.object({}).strict();
export const demandCollaborationPersonSchema = z.object({ personId: z.uuid() }).strict();
export const endDemandCollaborationSchema = z.object({ reason: plainText(500) }).strict();

export const runDemandRecommendationSchema = z.object({
  stage: z.enum(["CURRENT", "ALUMNI"]),
}).strict();

export const manualAddDemandRecommendationSchema = z.object({
  stage: z.enum(["CURRENT", "ALUMNI"]),
  personId: z.uuid(),
  reason: plainText(500),
  replaceItemId: z.uuid().nullable().default(null),
}).strict();

export const respondDemandRecommendationSchema = z.object({
  response: z.enum(["WILLING", "DECLINE"]),
  responseNote: optionalPlainText(500),
}).strict();

export const activateDemandAlumniHelpSchema = z.object({
  recommendationItemId: z.uuid(),
  townshipHandlerPersonId: z.uuid(),
  reason: plainText(500),
}).strict();

export const addDemandProgressSchema = z.object({
  currentProgress: plainText(5000),
  nextStep: plainText(5000),
  attachmentIds,
  representedPersonId: z.uuid().optional(),
}).strict();

export const demandProgressReminderSchema = z.object({}).strict();

export const submitDemandCloseSchema = z.object({
  solution: plainText(5000),
  connectedResources: plainText(5000),
  attachmentIds,
}).strict();

export const reviewDemandCloseSchema = z.object({
  decision: z.enum(["APPROVE", "RETURN"]),
  townshipVerificationResult: plainText(5000),
  reason: optionalPlainText(500),
  outcomePlan: outcomePlanSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.decision === "RETURN" && !value.reason) {
    context.addIssue({ code: "custom", path: ["reason"], message: "退回时必须填写原因" });
  }
  if (value.decision === "RETURN" && value.outcomePlan) {
    context.addIssue({ code: "custom", path: ["outcomePlan"], message: "退回办结时不能建立成效计划" });
  }
  if (value.decision === "APPROVE" && !value.outcomePlan) {
    context.addIssue({ code: "custom", path: ["outcomePlan"], message: "通过办结时必须选择成效跟踪策略" });
  }
});

export const requestDemandOwnerExitSchema = z.object({ reason: plainText(500) }).strict();

export const reviewDemandOwnerExitSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  reviewReason: optionalPlainText(500),
}).strict().superRefine((value, context) => {
  if (value.decision === "REJECT" && !value.reviewReason) {
    context.addIssue({ code: "custom", path: ["reviewReason"], message: "拒绝时必须填写审核原因" });
  }
});

export const previewDemandOwnerTransferSchema = z.object({
  newOwnerPersonId: z.uuid(),
  reason: plainText(500),
}).strict();

export const transferDemandOwnerSchema = previewDemandOwnerTransferSchema.extend({
  impactToken: trimmed(4000, 32),
  confirmation: z.literal("CONFIRM"),
}).strict();

export const cancelDemandSchema = z.object({ reason: plainText(500) }).strict();

export const demandListQuerySchema = z.object({
  status: optionalQueryString.pipe(z.enum([
    "DRAFT", "PENDING_REVIEW", "RETURNED", "PENDING_CLAIM", "IN_PROGRESS",
    "PENDING_CLOSE_REVIEW", "COMPLETED", "CANCELED", "MERGED",
  ]).optional()),
  type: optionalQueryString.pipe(demandType.optional()),
  areaId: optionalQueryString.pipe(z.uuid().optional()),
  batchId: optionalQueryString.pipe(z.uuid().optional()),
  keyword: optionalQueryString.pipe(z.string().trim().max(100).optional()),
  mine: z.preprocess(
    (value) => value === "true" ? true : value === "false" || value === undefined || value === null || value === "" ? false : value,
    z.boolean(),
  ),
  page: optionalInteger(1, 1_000_000),
  pageSize: optionalInteger(20, 100),
}).strict();

export type PublicDemandLeadInput = z.infer<typeof publicDemandLeadSchema>;
export type OtherDemandLeadInput = z.infer<typeof createOtherDemandLeadSchema>;
export type MemberVisitDemandLeadInput = z.infer<typeof memberVisitDemandLeadSchema>;
export type DemandLeadSupplementInput = z.infer<typeof addDemandLeadInfoSchema>;
export type ConvertDemandLeadInput = z.infer<typeof convertDemandLeadSchema>;
export type CreateFormalDemandInput = z.infer<typeof createFormalDemandSchema>;
export type UpdateDemandDraftInput = z.infer<typeof updateDemandDraftSchema>;
export type ReviewDemandInput = z.infer<typeof reviewDemandSchema>;
