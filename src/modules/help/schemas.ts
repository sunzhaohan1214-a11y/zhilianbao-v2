import { z } from "zod";

const text = (max: number, min = 1) => z.string().trim().min(min).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional();
const expectedDate = z.coerce.date();

export const createHelpRequestSchema = z
  .object({
    category: z.enum(["ACCOMMODATION", "TRANSPORTATION", "DINING", "WORK", "LIFE", "OTHER"]),
    title: text(200),
    description: text(5000),
    urgency: z.enum(["NORMAL", "URGENT"]).default("NORMAL"),
    attachmentIds: z.array(z.uuid()).max(20).default([]),
  })
  .strict();

export const assignHelpPersonSchema = z
  .object({
    personId: z.uuid(),
    expectedCompleteAt: expectedDate,
    reason: optionalText(500),
  })
  .strict();

export const transferHelpOrganizationSchema = z
  .object({
    organizationId: z.uuid(),
    expectedCompleteAt: expectedDate.optional(),
    reason: optionalText(500),
  })
  .strict();

export const claimHelpRequestSchema = z
  .object({ expectedCompleteAt: expectedDate.optional() })
  .strict();

export const addHelpProgressSchema = z
  .object({
    content: text(5000),
    nextStep: optionalText(2000),
    expectedCompleteAt: expectedDate.optional(),
    attachmentIds: z.array(z.uuid()).max(20).default([]),
  })
  .strict();

export const completeHelpRequestSchema = z
  .object({ completionSummary: text(5000) })
  .strict();

export const helpReasonSchema = z.object({ reason: text(500) }).strict();

export const reassignHelpRequestSchema = z
  .object({
    targetType: z.literal("PERSON"),
    personId: z.uuid(),
    expectedCompleteAt: expectedDate.optional(),
    reason: text(500),
  })
  .strict();

export const idempotencyKeySchema = text(200, 8);

const optionalQuery = z.preprocess(
  (value) => (value === null || value === "" ? undefined : value),
  z.string().optional(),
);
const pageNumber = (fallback: number, max: number) =>
  z.preprocess(
    (value) => value === undefined || value === null || value === "" ? fallback : Number(value),
    z.number().int().min(1).max(max),
  );

export const helpListQuerySchema = z
  .object({
    status: optionalQuery.pipe(z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "WITHDRAWN"]).optional()),
    category: optionalQuery.pipe(z.enum(["ACCOMMODATION", "TRANSPORTATION", "DINING", "WORK", "LIFE", "OTHER"]).optional()),
    urgency: optionalQuery.pipe(z.enum(["NORMAL", "URGENT"]).optional()),
    mode: optionalQuery.pipe(z.enum(["all", "submitted", "handled"]).default("all")),
    overdue: z.preprocess(
      (value) => value === "true" ? true : value === "false" || value === undefined ? false : value,
      z.boolean(),
    ),
    keyword: optionalQuery.pipe(z.string().trim().max(100).optional()),
    page: pageNumber(1, 1_000_000),
    pageSize: pageNumber(20, 100),
  })
  .strict();

export type CreateHelpRequestInput = z.infer<typeof createHelpRequestSchema>;
