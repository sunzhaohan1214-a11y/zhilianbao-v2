import { z } from "zod";

const optionalQuery = z.preprocess((value) => value === null || value === "" ? undefined : value, z.string().optional());
const pageNumber = (fallback: number, maximum: number) => z.preprocess(
  (value) => value === null || value === "" || value === undefined ? fallback : Number(value),
  z.number().int().min(1).max(maximum),
);

export const createImportBatchSchema = z.object({
  importType: z.enum(["ENTERPRISE", "MEMBER", "TALENT"]),
  sourceAttachmentId: z.uuid(),
  sheetName: z.string().trim().min(1).max(255).optional(),
}).strict();

export const importMappingSchema = z.object({
  sheetName: z.string().trim().min(1).max(255),
  columns: z.array(z.object({
    sourceColumn: z.number().int().min(1).max(100),
    sourceHeader: z.string().max(255),
    targetField: z.string().max(100).nullable(),
  }).strict()).min(1).max(100),
  parameters: z.record(z.string(), z.string().trim().max(255)).optional(),
}).strict();

export const selectImportSheetSchema = z.object({ sheetName: z.string().trim().min(1).max(255) }).strict();

export const resolveImportRowSchema = z.object({
  action: z.enum(["CREATE", "LINK_EXISTING", "SKIP"]),
  matchedEntityId: z.uuid().optional(),
  normalizedValues: z.record(z.string(), z.string().max(20_000)).optional(),
  reason: z.string().trim().min(1).max(500),
}).strict().superRefine((value, context) => {
  if (value.action === "LINK_EXISTING" && !value.matchedEntityId) context.addIssue({ code: "custom", message: "匹配已有对象时必须选择对象" });
  if (value.action !== "LINK_EXISTING" && value.matchedEntityId) context.addIssue({ code: "custom", message: "当前动作不能指定已有对象" });
});

export const confirmImportSchema = z.object({
  confirm: z.literal(true),
  expectedPreviewVersion: z.number().int().positive(),
  reason: z.string().trim().min(1).max(500),
}).strict();

export const importListQuerySchema = z.object({
  importType: optionalQuery.pipe(z.enum(["ENTERPRISE", "MEMBER", "TALENT"]).optional()),
  status: optionalQuery.pipe(z.enum(["UPLOADED", "PARSING", "MAPPING_REQUIRED", "PREVIEW_READY", "APPLYING", "SUCCEEDED", "FAILED", "CANCELED"]).optional()),
  page: pageNumber(1, 1_000_000),
  pageSize: pageNumber(20, 100),
}).strict();

export const enterpriseExportSchema = z.object({
  keyword: z.string().trim().max(100).optional(),
  areaId: z.uuid().optional(),
  tagId: z.uuid().optional(),
  status: z.enum(["NORMAL", "DISABLED", "MERGED"]).default("NORMAL"),
}).strict();

export const talentExportSchema = z.object({
  scopeType: z.enum(["DOMESTIC", "OVERSEAS"]).optional(),
  organization: z.string().trim().max(100).optional(),
  professionalDirection: z.string().trim().max(100).optional(),
  status: z.enum(["ACTIVE", "DISABLED", "MERGED"]).default("ACTIVE"),
}).strict();
