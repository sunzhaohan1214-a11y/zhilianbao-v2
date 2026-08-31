import { z } from "zod";
import { LEGACY_ENTITY_TYPES, type LegacyEntityType, type LegacyRecord, type MigrationPreviewIssue } from "./types";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const sourceId = z.string().trim().min(1).max(191);
const dateTime = z.iso.datetime({ offset: true });

export const snapshotManifestSchema = z.object({
  sourceSystem: z.literal("ZHILIANBAO_V1"),
  schemaVersion: z.string().trim().min(1).max(100),
  snapshotId: z.string().trim().min(1).max(191),
  snapshotAt: dateTime,
  exportedAt: dateTime,
  isSanitized: z.boolean(),
  snapshotKind: z.enum(["SAMPLE", "FULL"]),
  mappingVersion: z.string().trim().min(1).max(100),
  files: z.record(z.string(), z.object({ count: z.number().int().nonnegative(), sha256 }).strict()),
  entities: z.record(z.enum(LEGACY_ENTITY_TYPES), z.number().int().nonnegative()),
}).strict();

export type SnapshotManifest = z.infer<typeof snapshotManifestSchema>;

const base = { sourceId, sourceUpdatedAt: dateTime.optional() };
const schemas = {
  ORGANIZATION: z.object({ ...base, name: z.string().trim().min(1).max(200), organizationType: z.enum(["TOWNSHIP", "DEPARTMENT", "DISPATCH_UNIT", "POST_UNIT"]), status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE") }).strict(),
  PERSON: z.object({ ...base, name: z.string().trim().min(1).max(80), phone: z.string().trim().max(30).optional(), memberKind: z.enum(["CURRENT", "ALUMNI_PLATFORM", "ALUMNI_HISTORICAL", "INTERNAL_STAFF", "FUTURE_MEMBER_CANDIDATE"]), currentEmploymentConfirmed: z.boolean().default(false), accountEligible: z.boolean().default(false), batchName: z.string().trim().max(100).optional(), startDate: z.iso.date().optional(), endDate: z.iso.date().optional() }).strict(),
  ENTERPRISE: z.object({ ...base, name: z.string().trim().min(1).max(200), responsibleAreaName: z.string().trim().min(1).max(200), address: z.string().trim().min(1).max(500), creditCode: z.string().trim().max(32).optional(), legalRepresentative: z.string().trim().max(80).optional(), introduction: z.string().trim().max(5000).optional(), mainProducts: z.string().trim().min(1).max(5000), qualificationsHonors: z.string().trim().max(5000).optional(), latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional(), contactName: z.string().trim().max(80).optional(), contactPhone: z.string().trim().max(30).optional(), primaryContactConfirmed: z.boolean().default(false), legacyTagNames: z.array(z.string().trim().min(1).max(100)).max(100).optional() }).strict(),
  TALENT: z.object({ ...base, name: z.string().trim().min(1).max(80), organizationName: z.string().trim().min(1).max(200), professionalDirection: z.string().trim().min(1).max(1000), title: z.string().trim().min(1).max(200), scopeType: z.enum(["DOMESTIC", "OVERSEAS"]).default("DOMESTIC"), recommenderSourceId: sourceId.optional(), resumeTextContactDetected: z.boolean().default(false) }).strict(),
  POLICY: z.object({ ...base, title: z.string().trim().min(1).max(300), publishingDepartment: z.string().trim().min(1).max(200), publishedDate: z.iso.date(), primaryFileSha256: sha256, status: z.enum(["ACTIVE", "WITHDRAWN", "REPLACED"]).default("ACTIVE") }).strict(),
  DEMAND: z.object({ ...base, title: z.string().trim().min(1).max(300), description: z.string().trim().min(1).max(20000), enterpriseSourceId: sourceId, contactName: z.string().trim().max(80).optional(), contactPhone: z.string().trim().max(30).optional(), legacyStatus: z.enum(["待对接", "已对接", "已解决"]), legacyType: z.string().trim().max(100).optional(), ownerPersonSourceId: sourceId.optional(), progress: z.array(z.object({ sourceId, content: z.string().trim().min(1).max(5000), occurredAt: dateTime, actorPersonSourceId: sourceId.optional() }).strict()).default([]) }).strict(),
  PRESENCE: z.object({ ...base, personSourceId: sourceId, arrivedAt: dateTime, departedAt: dateTime.optional(), note: z.string().trim().max(1000).optional() }).strict(),
  TRIP: z.object({ ...base, title: z.string().trim().min(1).max(300), occurredAt: dateTime, participantSourceIds: z.array(sourceId).min(1), stableV2Nodes: z.boolean().default(false), historicalSummary: z.string().trim().max(5000).optional() }).strict(),
  VISIT: z.object({ ...base, enterpriseSourceId: sourceId, occurredAt: dateTime, summary: z.string().trim().min(1).max(5000) }).strict(),
  REIMBURSEMENT: z.object({ ...base, applicantPersonSourceId: sourceId, type: z.enum(["TRAVEL", "ACTIVITY"]), reason: z.string().trim().min(1).max(2000), legacyStatus: z.enum(["审核中", "已退回", "已通过"]), totalAmount: z.string().regex(/^\d+(?:\.\d{1,2})?$/) }).strict(),
  HELP: z.object({ ...base, submitterPersonSourceId: sourceId, title: z.string().trim().min(1).max(200), description: z.string().trim().min(1).max(20000), legacyCategory: z.string().trim().min(1).max(100), status: z.enum(["待受理", "处理中", "已办结"]).default("待受理"), result: z.string().trim().max(5000).optional() }).strict(),
  ANNOUNCEMENT: z.object({ ...base, title: z.string().trim().min(1).max(300), body: z.string().trim().min(1).max(50000), publishedAt: dateTime.optional(), hasReliableConfirmations: z.boolean().default(false) }).strict(),
  ROLE: z.object({ ...base, personSourceId: sourceId, roleCode: z.string().trim().min(1).max(100), evidence: z.string().trim().max(1000).optional(), explicitlyAuditable: z.boolean().default(false) }).strict(),
} as const satisfies Record<LegacyEntityType, z.ZodType>;

export type LegacyPayload<T extends LegacyEntityType = LegacyEntityType> = z.infer<(typeof schemas)[T]>;

export function validateLegacyPayload(entityType: LegacyEntityType, value: unknown): { record?: LegacyRecord; issues: MigrationPreviewIssue[] } {
  const parsed = schemas[entityType].safeParse(value);
  if (parsed.success) return { record: { sourceId: (parsed.data as { sourceId: string }).sourceId, entityType, payload: parsed.data as Record<string, unknown> }, issues: [] };
  const fallbackId = typeof value === "object" && value && "sourceId" in value ? String((value as { sourceId: unknown }).sourceId) : "UNKNOWN";
  const issues: MigrationPreviewIssue[] = parsed.error.issues.map((issue) => ({
    sourceEntity: entityType,
    sourceId: fallbackId,
    code: issue.code === "unrecognized_keys" ? "UNMAPPED_SOURCE_FIELD" : "MIGRATION_SOURCE_INVALID",
    severity: issue.code === "unrecognized_keys" ? "REVIEW" : "BLOCKER",
    field: issue.path.join(".") || undefined,
    message: issue.message,
    sourceSnapshot: typeof value === "object" && value ? value as Record<string, unknown> : undefined,
  }));
  return { issues };
}

export const attachmentManifestRecordSchema = z.object({
  sourceAttachmentId: sourceId,
  sourceEntity: z.enum(LEGACY_ENTITY_TYPES),
  sourceId,
  relativePath: z.string().trim().min(1).max(500),
  sha256,
  size: z.number().int().nonnegative(),
  originalFilename: z.string().trim().min(1).max(255),
  declaredMimeType: z.string().trim().min(1).max(191),
}).strict();

export type LegacyAttachmentManifestRecord = z.infer<typeof attachmentManifestRecordSchema>;

export const migrationResolutionFileSchema = z.object({
  version: z.string().trim().min(1).max(100),
  resolutions: z.array(z.object({
    sourceEntity: z.enum(LEGACY_ENTITY_TYPES), sourceId, action: z.enum(["LINK", "CREATE", "SKIP", "WAIVE"]),
    targetEntity: z.string().trim().max(100).optional(), targetId: z.uuid().optional(), reason: z.string().trim().min(1).max(500), operator: z.string().trim().min(1).max(100),
  }).strict()),
}).strict();
