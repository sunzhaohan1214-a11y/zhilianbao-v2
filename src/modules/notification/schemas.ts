import { z } from "zod";

export const notificationListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

export const todoListSchema = notificationListSchema.extend({
  module: z.string().trim().min(1).max(100).optional(),
  status: z.enum(["OPEN", "COMPLETED", "STALE"]).default("OPEN"),
}).strict();
