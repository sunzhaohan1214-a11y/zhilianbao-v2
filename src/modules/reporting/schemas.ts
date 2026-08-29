import { z } from "zod";

export const monthlyReportQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  batchId: z.uuid().optional(),
  areaId: z.uuid().optional(),
}).strict();

export const monthlyReportExportSchema = monthlyReportQuerySchema;
