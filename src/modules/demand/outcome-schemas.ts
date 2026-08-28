import { z } from "zod";
import { parseDateOnly } from "./outcome-date";

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).transform((value) => value || undefined).optional();
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期必须为 YYYY-MM-DD").refine((value) => {
  try { parseDateOnly(value); return true; } catch { return false; }
}, "日期不是有效的自然日");
const money = z.string().trim().regex(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/, "金额必须是非负且最多两位小数");
const count = z.number().int().min(0).max(2_147_483_647);
const attachmentIds = z.array(z.uuid()).max(20).default([]);

export const outcomePlanSchema = z.discriminatedUnion("trackingMode", [
  z.object({ trackingMode: z.literal("NONE") }).strict(),
  z.object({ trackingMode: z.literal("TRACKING"), firstTrackingDate: dateOnly }).strict(),
]);

const roundFields = {
  trackingDate: dateOnly,
  contractAmountIncrement: money.default("0"),
  investmentAmountIncrement: money.default("0"),
  policyFundIncrement: money.default("0"),
  costReductionIncrement: money.default("0"),
  talentIntroducedIncrement: count.default(0),
  patentIncrement: count.default(0),
  qualitativeResult: optionalText(5000),
  enterpriseFeedback: optionalText(5000),
  nextTrackingDate: dateOnly.nullable().optional(),
  endTracking: z.boolean(),
  attachmentIds,
};

function validateRound(value: Record<string, unknown>, context: z.RefinementCtx) {
  const moneyFields = ["contractAmountIncrement", "investmentAmountIncrement", "policyFundIncrement", "costReductionIncrement"];
  const hasMoney = moneyFields.some((field) => Number(value[field]) > 0);
  const hasCount = Number(value.talentIntroducedIncrement) > 0 || Number(value.patentIncrement) > 0;
  if (!hasMoney && !hasCount && !value.qualitativeResult && !value.enterpriseFeedback) {
    context.addIssue({ code: "custom", message: "至少填写一项定量、定性成效或企业反馈" });
  }
  if (value.endTracking === true && value.nextTrackingDate) {
    context.addIssue({ code: "custom", path: ["nextTrackingDate"], message: "结束跟踪时不能填写下次跟踪日期" });
  }
  if (value.endTracking === false && !value.nextTrackingDate) {
    context.addIssue({ code: "custom", path: ["nextTrackingDate"], message: "继续跟踪时必须填写下次跟踪日期" });
  }
  if (typeof value.trackingDate === "string" && typeof value.nextTrackingDate === "string" && value.nextTrackingDate <= value.trackingDate) {
    context.addIssue({ code: "custom", path: ["nextTrackingDate"], message: "下次跟踪日期必须晚于实际跟踪日期" });
  }
}

export const createOutcomeRoundSchema = z.object(roundFields).strict().superRefine(validateRound);
export const updateOutcomeRoundSchema = z.object({ expectedVersion: z.number().int().min(1), ...roundFields }).strict().superRefine(validateRound);
export const submitOutcomeRoundSchema = z.object({ expectedVersion: z.number().int().min(1) }).strict();
export const reviewOutcomeRoundSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("APPROVE"), verifiedNote: optionalText(2000) }).strict(),
  z.object({ decision: z.literal("RETURN"), reason: text(500) }).strict(),
]);

export type OutcomePlanInput = z.infer<typeof outcomePlanSchema>;
export type OutcomeRoundInput = z.infer<typeof createOutcomeRoundSchema>;
