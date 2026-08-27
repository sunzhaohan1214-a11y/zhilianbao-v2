import { z } from "zod";

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const exactBooleanSchema = z.union([
  z.boolean(),
  z.enum(["true", "false"]).transform((value) => value === "true"),
]);

export const notificationListSchema = paginationSchema.extend({
  unread: exactBooleanSchema.optional(),
  type: z.string().trim().min(1).max(100).optional(),
  module: z.enum(["ANNOUNCEMENT", "DEMAND", "HELP", "TRIP", "REIMBURSEMENT"]).optional(),
}).strict();

export const todoListSchema = paginationSchema.extend({
  module: z.string().trim().min(1).max(100).optional(),
  status: z.enum(["OPEN", "COMPLETED", "STALE"]).default("OPEN"),
}).strict();
