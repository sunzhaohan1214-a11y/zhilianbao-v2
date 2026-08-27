import { z } from "zod";

const trimmedOptional = (maximum: number) => z.string().trim().max(maximum).optional();
const nullableTrimmed = (maximum: number) => z.union([z.string().trim().max(maximum), z.null()]).optional();
const isoInstant = z.string().datetime({ offset: true }).transform((value) => new Date(value));

const intervalShape = {
  arrivalAt: isoInstant,
  expectedDepartureAt: isoInstant,
};

export const presenceCreateSchema = z.object({
  ...intervalShape,
  origin: trimmedOptional(200),
  transportMode: trimmedOptional(100),
  trainFlightNo: trimmedOptional(100),
  note: trimmedOptional(1000),
}).strict().refine(
  ({ arrivalAt, expectedDepartureAt }) => expectedDepartureAt > arrivalAt,
  { message: "预计离宝时间必须晚于到宝时间", path: ["expectedDepartureAt"] },
);

export const presenceUpdateSchema = z.object({
  arrivalAt: isoInstant.optional(),
  expectedDepartureAt: isoInstant.optional(),
  origin: nullableTrimmed(200),
  transportMode: nullableTrimmed(100),
  trainFlightNo: nullableTrimmed(100),
  note: nullableTrimmed(1000),
}).strict().refine((changes) => Object.keys(changes).length > 0, "至少填写一项修改内容");

export const presenceCancelSchema = z.object({
  reason: z.string().trim().min(1).max(500),
}).strict();

export const presenceCorrectionSchema = z.object({
  changes: z.object({
    arrivalAt: isoInstant.optional(),
    expectedDepartureAt: isoInstant.optional(),
    origin: nullableTrimmed(200),
    transportMode: nullableTrimmed(100),
    trainFlightNo: nullableTrimmed(100),
    note: nullableTrimmed(1000),
    canceledAt: z.union([isoInstant, z.null()]).optional(),
    cancelReason: nullableTrimmed(500),
  }).strict().refine((changes) => Object.keys(changes).length > 0, "至少填写一项纠错内容"),
  reason: z.string().trim().min(1).max(500),
}).strict();

export const presenceHistoryQuerySchema = z.object({
  personId: z.uuid().optional(),
  keyword: z.string().trim().max(80).optional(),
  status: z.enum(["FUTURE", "IN_BAO", "ENDED", "CANCELED"]).optional(),
  from: isoInstant.optional(),
  to: isoInstant.optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict().refine(
  ({ from, to }) => !from || !to || to > from,
  { message: "结束筛选时间必须晚于开始时间", path: ["to"] },
);

export type PresenceStatus = "FUTURE" | "IN_BAO" | "ENDED" | "CANCELED";

export function intervalsOverlap(
  left: { arrivalAt: Date; expectedDepartureAt: Date },
  right: { arrivalAt: Date; expectedDepartureAt: Date },
) {
  return left.arrivalAt < right.expectedDepartureAt && left.expectedDepartureAt > right.arrivalAt;
}

export function canSelfMutatePresence(
  report: { expectedDepartureAt: Date; canceledAt: Date | null },
  now: Date,
) {
  return report.canceledAt === null && report.expectedDepartureAt > now;
}

export function derivePresenceStatus(
  report: { arrivalAt: Date; expectedDepartureAt: Date; canceledAt: Date | null },
  now: Date,
): PresenceStatus {
  if (report.canceledAt) return "CANCELED";
  if (now < report.arrivalAt) return "FUTURE";
  if (now < report.expectedDepartureAt) return "IN_BAO";
  return "ENDED";
}
