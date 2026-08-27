import { z } from "zod";

const plain = (maximum: number, minimum = 1) => z.string().trim().min(minimum).max(maximum).refine(
  (value) => !/[<>]/.test(value),
  "不允许提交 HTML",
);
const nullablePlain = (maximum: number) => z.union([plain(maximum), z.literal(""), z.null()]).optional();
const isoInstant = z.string().datetime({ offset: true }).transform((value) => new Date(value));
const attachmentIds = z.array(z.uuid()).max(10).default([]);

export const tripNodeSchema = z.object({
  plannedStartAt: isoInstant,
  plannedEndAt: isoInstant.optional(),
  enterpriseId: z.uuid().optional(),
  locationName: plain(200),
  address: nullablePlain(500),
  content: plain(5000),
}).strict();

const duplicateDecisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CONTINUE_CREATE") }).strict(),
  z.object({ action: z.literal("JOIN_EXISTING"), tripId: z.uuid() }).strict(),
]);

export const tripCreateSchema = z.object({
  title: plain(200),
  purpose: plain(5000),
  note: nullablePlain(2000),
  overallEndAt: isoInstant.optional(),
  participantIds: z.array(z.uuid()).max(50).default([]),
  nodes: z.array(tripNodeSchema).min(1).max(30),
  duplicateDecision: duplicateDecisionSchema.optional(),
}).strict();

export const tripUpdateSchema = z.object({
  title: plain(200).optional(),
  purpose: plain(5000).optional(),
  note: nullablePlain(2000),
  overallEndAt: z.union([isoInstant, z.null()]).optional(),
  nodes: z.array(tripNodeSchema).min(1).max(30).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "至少填写一项修改内容");

export const tripCancelSchema = z.object({ reason: plain(500) }).strict();
export const tripParticipantSchema = z.object({ personId: z.uuid() }).strict();

export const tripResultSchema = z.object({
  resultSummary: plain(10000),
  nextStep: nullablePlain(5000),
  nodeResults: z.array(z.object({ tripNodeId: z.uuid(), resultSummary: nullablePlain(5000) }).strict()).max(30).default([]),
  attachmentIds,
}).strict();

export const tripResultUpdateSchema = z.object({
  resultSummary: plain(10000).optional(),
  nextStep: nullablePlain(5000),
  attachmentIds,
}).strict().refine(
  (value) => value.resultSummary !== undefined || value.nextStep !== undefined || value.attachmentIds.length > 0,
  "至少填写一项结果修改内容",
);

export const visitSupplementSchema = z.object({
  content: plain(5000),
  attachmentIds,
}).strict();

export const visitDemandLeadSchema = z.object({
  title: plain(200),
  description: plain(5000),
  contactId: z.uuid().optional(),
  note: nullablePlain(2000),
  attachmentIds,
}).strict();

export const visitCorrectionSchema = z.object({
  changes: z.object({
    visitedAt: isoInstant.optional(),
    visitSummary: nullablePlain(5000),
  }).strict().refine((value) => Object.keys(value).length > 0, "至少填写一项纠错内容"),
  reason: plain(500),
}).strict();

export const tripCorrectionSchema = z.object({
  changes: tripUpdateSchema,
  reason: plain(500),
}).strict();

export const tripListQuerySchema = z.object({
  status: z.enum(["PLANNED", "IN_PROGRESS", "PENDING_RESULT", "COMPLETED", "CANCELED"]).optional(),
  participant: z.enum(["ME", "ALL"]).default("ALL"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

export const idempotencyKeySchema = plain(128, 8).regex(/^[A-Za-z0-9._:-]+$/);

export type TripNodeInput = z.infer<typeof tripNodeSchema>;
export type TripCreateInput = z.infer<typeof tripCreateSchema>;
export type TripUpdateInput = z.infer<typeof tripUpdateSchema>;
export type TripResultInput = z.infer<typeof tripResultSchema>;
export type VisitDemandLeadInput = z.infer<typeof visitDemandLeadSchema>;
