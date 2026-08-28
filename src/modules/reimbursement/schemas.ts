import { z } from "zod";
import { ACTIVITY_EXPENSE_TYPES, TRAVEL_EXPENSE_TYPES } from "./constants";

const text = (max: number, min = 1) => z.string().trim().min(min).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional();
const money = z.union([z.string(), z.number()]).transform(String).pipe(
  z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/),
);
const optionalMoney = z.union([z.string(), z.number()]).transform(String).pipe(
  z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/),
).optional();

export const expenseSchema = z.object({
  expenseType: z.enum([...TRAVEL_EXPENSE_TYPES, ...ACTIVITY_EXPENSE_TYPES]),
  customExpenseName: optionalText(200),
  description: optionalText(1000),
  expenseDate: z.coerce.date().optional(),
  amount: money,
  invoiceId: z.uuid().optional(),
  source: z.enum(["MANUAL", "OCR"]).default("MANUAL"),
  referenceRate: optionalMoney,
  claimedDays: optionalMoney,
  calculationNote: optionalText(1000),
}).strict();

export const reimbursementDraftSchema = z.object({
  type: z.enum(["TRAVEL", "ACTIVITY"]),
  reason: text(2000),
  linkedTripId: z.uuid().nullable().optional(),
  expenses: z.array(expenseSchema).max(100).default([]),
}).strict();

export const reimbursementListQuerySchema = z.object({
  status: z.preprocess((v) => v === "" ? undefined : v, z.enum([
    "DRAFT", "PENDING_ONLINE_REVIEW", "RETURNED", "VERIFIED_PENDING_PAPER",
    "PAPER_RECEIVED", "FINANCE_SUBMITTED",
  ]).optional()),
  type: z.preprocess((v) => v === "" ? undefined : v, z.enum(["TRAVEL", "ACTIVITY"]).optional()),
  mode: z.enum(["mine", "manage"]).default("mine"),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

export const addInvoiceSchema = z.object({ attachmentId: z.uuid() }).strict();
export const confirmInvoiceSchema = z.object({
  expenseType: z.enum([...TRAVEL_EXPENSE_TYPES, ...ACTIVITY_EXPENSE_TYPES]),
  invoiceDate: z.coerce.date().optional(),
  amount: optionalMoney,
  seller: optionalText(300),
  invoiceNo: optionalText(100),
}).strict();
export const reasonSchema = z.object({ reason: text(500) }).strict();
export const emptySchema = z.object({}).strict();
export const stateCorrectionSchema = z.object({
  fromState: z.enum(["PENDING_ONLINE_REVIEW", "RETURNED", "VERIFIED_PENDING_PAPER", "PAPER_RECEIVED", "FINANCE_SUBMITTED"]),
  toState: z.enum(["PENDING_ONLINE_REVIEW", "RETURNED", "VERIFIED_PENDING_PAPER", "PAPER_RECEIVED", "FINANCE_SUBMITTED"]),
  reason: text(500),
}).strict();
export const reimbursementExportSchema = z.object({
  reimbursementIds: z.array(z.uuid()).min(1).max(500).transform((ids) => [...new Set(ids)]),
  format: z.enum(["XLSX", "PDF"]),
}).strict().superRefine((value, ctx) => {
  if (value.format === "PDF" && value.reimbursementIds.length !== 1) {
    ctx.addIssue({ code: "custom", path: ["reimbursementIds"], message: "PDF 仅支持单份报销单" });
  }
});
export const idempotencyKeySchema = text(200, 8);
