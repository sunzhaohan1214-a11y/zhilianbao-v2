import { createHash } from "node:crypto";
import { Prisma, type ImportBatch, type ImportRow } from "@/generated/prisma/client";
import type { AuthRequestContext } from "@/modules/identity/request-context";
import { prepareInitialAccountCredential } from "@/modules/identity/account-service";
import type { PermissionActor } from "@/modules/permissions/types";
import { authorizeActor } from "@/modules/permissions/authorization";
import { getAttachmentRuntime } from "@/modules/attachment/runtime";
import { EnterpriseService } from "@/modules/enterprise/enterprise-service";
import { MemberService, type MemberImportWrite } from "@/modules/member-foundation/member-service";
import { TalentService } from "@/modules/talent/talent-service";
import { matchPerson, normalizeImportPhone } from "@/modules/entity-matching";
import { autoMapHeaders, importFieldRegistry, validateMapping } from "./field-registry";
import { ImportExportError } from "./errors";
import { buildPreviewRows } from "./preview";
import { ImportRepository, type ImportTransaction } from "./repository";
import { confirmImportSchema, createImportBatchSchema, importMappingSchema, resolveImportRowSchema, selectImportSheetSchema } from "./schemas";
import type { ImportMapping, ParsedImportRow } from "./types";
import { buildImportResultWorkbook, buildImportTemplate, inspectWorkbook, parseMappedSheet, readHeaders, MAX_IMPORT_FILE_BYTES } from "./workbook";
import { BackupService } from "@/modules/system/backup-service";

type ServiceInput = { actor: PermissionActor; context?: AuthRequestContext };
type JsonRecord = Record<string, string>;

function isAdmin(actor: PermissionActor): boolean {
  return actor.effectiveRoles.includes("ADMIN") || actor.effectiveRoles.includes("SUPER_ADMIN");
}
function requireAdmin(actor: PermissionActor) {
  if (!isAdmin(actor) || !actor.hasGlobalOperational) throw new ImportExportError("IMPORT_FORBIDDEN", "只有当前有效管理员可以执行批量导入");
}
function jsonRecord(value: Prisma.JsonValue | null): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}
function yes(value: string | undefined): boolean {
  return ["是", "true", "1", "yes", "y"].includes((value ?? "").trim().toLocaleLowerCase("zh-CN"));
}
function maskedPhone(value: string): string {
  return /^1\d{10}$/.test(value) ? `${value.slice(0, 3)}****${value.slice(-4)}` : value;
}
function safeErrorCode(error: unknown): string {
  if (error instanceof ImportExportError) return error.code;
  if (typeof error === "object" && error && "code" in error && typeof error.code === "string") return error.code.slice(0, 100);
  return "IMPORT_APPLY_FAILED";
}
function payloadHash(batchId: string, previewVersion: number, reason: string): string {
  return createHash("sha256").update(JSON.stringify({ batchId, previewVersion, reason, confirm: true })).digest("hex");
}
function keyHash(key: string): string { return createHash("sha256").update(key).digest("hex"); }
function phoneIdentityHash(phone: string): string { return createHash("sha256").update(`PHONE:${normalizeImportPhone(phone)}`).digest("hex"); }
function isIdempotencyUniqueViolation(error: unknown): boolean {
  if (!(typeof error === "object" && error && "code" in error && error.code === "P2002")) return false;
  const meta = "meta" in error && error.meta && typeof error.meta === "object" ? error.meta as Record<string, unknown> : {};
  const target = Array.isArray(meta.target) ? meta.target.join(",") : String(meta.target ?? meta.constraint ?? "");
  return target.includes("actor_person_id") && target.includes("action") && target.includes("key_hash")
    || target.includes("import_command_idempotency_actor_person_id_action_key_hash_key");
}
const EXPLICIT_IDENTITY_REVIEW_CODES = new Set([
  "PERSON_SAME_NAME_DIFFERENT_PHONE", "PERSON_PHONE_DUPLICATED",
  "ENTERPRISE_NAME_AREA_CANDIDATE", "ENTERPRISE_CREDIT_CODE_DUPLICATED", "ENTERPRISE_PRIMARY_CONTACT_CONFLICT",
  "TALENT_DUPLICATE_CANDIDATE",
]);
function toDate(value: string | undefined): Date {
  const parsed = new Date(`${value}T00:00:00.000+08:00`);
  if (!value || Number.isNaN(parsed.valueOf())) throw new ImportExportError("IMPORT_ROW_RESOLUTION_INVALID", "导入行日期不正确");
  return parsed;
}
function publicRow(row: ImportRow) {
  const normalized = { ...jsonRecord(row.normalizedJson) };
  for (const field of ["phone", "contactPhone"]) if (normalized[field]) normalized[field] = maskedPhone(normalized[field]);
  return { ...row, rawJson: undefined, normalizedJson: normalized };
}

export class ImportService {
  private readonly enterprise = new EnterpriseService();
  private readonly member = new MemberService();
  private readonly talent = new TalentService();
  constructor(private readonly repository = new ImportRepository(), private readonly backups = new BackupService(repository.prisma)) {}

  private logBatch(event: string, value: { batchId: string; importType: string; status: string; rowCount?: number; createdCount?: number; updatedCount?: number; linkedCount?: number; skippedCount?: number; duration?: number }) {
    console.info(JSON.stringify({ event, ...value }));
  }

  private async markFailed(input: ServiceInput & { batchId: string }, error: unknown, statuses: Array<ImportBatch["status"]>, mappingVersion?: number) {
    const errorCode = safeErrorCode(error);
    const failed = await this.repository.transaction(async (tx) => {
      const batch = await tx.importBatch.findUnique({ where: { id: input.batchId } });
      if (!batch || !statuses.includes(batch.status) || (mappingVersion !== undefined && batch.mappingVersion !== mappingVersion)) return null;
      const updated = await tx.importBatch.update({ where: { id: batch.id }, data: { status: "FAILED", failedAt: new Date(), errorCode } });
      await tx.auditLog.create({ data: { actorPersonId: input.actor.personId, actorAccountId: input.actor.accountId, actionCode: "IMPORT_BATCH_FAILED", entityType: "IMPORT_BATCH", entityId: batch.id,
        afterJson: { errorCode }, requestId: input.context?.requestId, ip: input.context?.ip, device: input.context?.deviceName } });
      return updated;
    });
    if (failed) this.logBatch("import_batch_failed", { batchId: failed.id, importType: failed.importType, status: failed.status, rowCount: failed.rowCount });
  }

  private async authorize(input: ServiceInput) {
    requireAdmin(input.actor);
    await authorizeActor({ actor: input.actor, action: "import.execute", resource: { resourceType: "import_batch", requiredScope: "GLOBAL_OPERATIONAL" } });
  }

  private async readSource(batch: Pick<ImportBatch, "sourceAttachmentId">): Promise<Buffer> {
    const attachment = await this.repository.prisma.attachment.findUnique({ where: { id: batch.sourceAttachmentId } });
    if (!attachment || attachment.uploadStatus !== "UPLOADED" || attachment.scanStatus !== "PASSED" || attachment.detectedFileType !== "xlsx" || !attachment.objectKey || !attachment.sha256) {
      throw new ImportExportError("IMPORT_FILE_INVALID", "源文件未完成上传、安全扫描或不是有效 xlsx");
    }
    if (!attachment.actualSizeBytes || attachment.actualSizeBytes > BigInt(MAX_IMPORT_FILE_BYTES)) throw new ImportExportError("IMPORT_BATCH_TOO_LARGE", "导入文件不能超过 20MB");
    return getAttachmentRuntime().storage.readObject(attachment.objectKey);
  }

  private async stagePreview(batchId: string, mapping: ImportMapping, sheetName: string, mappingVersion: number, expectedStatus: "UPLOADED" | "PARSING") {
    const batch = await this.repository.prisma.importBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new ImportExportError("IMPORT_NOT_FOUND", "导入批次不存在");
    const buffer = await this.readSource(batch);
    let parsed: ParsedImportRow[];
    try { parsed = await parseMappedSheet(buffer, mapping, sheetName); }
    catch (error) {
      const code = error instanceof Error ? error.message : "IMPORT_FILE_INVALID";
      throw new ImportExportError(code === "IMPORT_BATCH_TOO_LARGE" ? "IMPORT_BATCH_TOO_LARGE" : code === "IMPORT_MAPPING_INVALID" ? "IMPORT_MAPPING_INVALID" : "IMPORT_FILE_INVALID", "工作簿无法按当前映射解析");
    }
    const staged = await buildPreviewRows(this.repository.prisma, batch.importType, mappingVersion, parsed);
    const blocking = staged.filter(({ resolutionStatus }) => resolutionStatus === "BLOCKED" || resolutionStatus === "NEEDS_REVIEW").length;
    const warnings = staged.filter(({ issuesJson }) => (issuesJson as Array<{ severity?: string }>).some(({ severity }) => severity === "WARNING")).length;
    await this.repository.transaction(async (tx) => {
      await this.repository.lockBatch(tx, batchId).catch(() => { throw new ImportExportError("IMPORT_NOT_FOUND", "导入批次不存在"); });
      const current = await tx.importBatch.findUniqueOrThrow({ where: { id: batchId } });
      if (current.status !== expectedStatus || current.mappingVersion !== mappingVersion) throw new ImportExportError("IMPORT_PREVIEW_STALE", "导入映射已变化，请刷新后重试");
      await tx.importRow.deleteMany({ where: { batchId } });
      if (staged.length) await tx.importRow.createMany({ data: staged.map((row) => ({ ...row, batchId })) });
      await tx.importBatch.update({ where: { id: batchId }, data: {
        status: "PREVIEW_READY", sheetName, mappingJson: mapping as unknown as Prisma.InputJsonObject,
        previewVersion: { increment: 1 }, rowCount: staged.length, validRowCount: staged.length - blocking,
        blockingRowCount: blocking, warningRowCount: warnings, parsedAt: new Date(), failedAt: null, errorCode: null,
      } });
    });
  }

  async create(input: ServiceInput & { body: unknown }) {
    await this.authorize(input);
    const body = createImportBatchSchema.parse(input.body);
    const attachment = await this.repository.prisma.attachment.findUnique({ where: { id: body.sourceAttachmentId }, include: { links: true } });
    if (!attachment || attachment.uploadedByPersonId !== input.actor.personId || !attachment.isTemporary || attachment.links.length > 0
      || attachment.uploadStatus !== "UPLOADED" || attachment.scanStatus !== "PASSED" || attachment.detectedFileType !== "xlsx" || !attachment.sha256 || !attachment.objectKey) {
      throw new ImportExportError("IMPORT_FILE_INVALID", "仅可使用本人本次上传且已通过安全扫描的私有 xlsx");
    }
    if (!attachment.actualSizeBytes || attachment.actualSizeBytes > BigInt(MAX_IMPORT_FILE_BYTES)) throw new ImportExportError("IMPORT_BATCH_TOO_LARGE", "导入文件不能超过 20MB");
    const buffer = await getAttachmentRuntime().storage.readObject(attachment.objectKey);
    let sheets;
    try { sheets = await inspectWorkbook(buffer); }
    catch (error) { throw new ImportExportError(error instanceof Error && error.message === "IMPORT_BATCH_TOO_LARGE" ? "IMPORT_BATCH_TOO_LARGE" : "IMPORT_FILE_INVALID", "xlsx 工作簿无法读取"); }
    const selectedSheet = body.sheetName ?? (sheets.length === 1 ? sheets[0].name : undefined);
    if (selectedSheet && !sheets.some(({ name }) => name === selectedSheet)) throw new ImportExportError("IMPORT_FILE_INVALID", "指定 Sheet 不存在");
    const batch = await this.repository.transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM attachments WHERE id = ${attachment.id} FOR UPDATE`;
      if (locked.length !== 1) throw new ImportExportError("IMPORT_FILE_INVALID", "源附件不存在");
      const current = await tx.attachment.findUniqueOrThrow({ where: { id: attachment.id }, include: { links: true } });
      if (!current.isTemporary || current.links.length > 0 || current.scanStatus !== "PASSED" || current.sha256 !== attachment.sha256) throw new ImportExportError("IMPORT_FILE_INVALID", "源附件状态已变化");
      const created = await tx.importBatch.create({ data: { importType: body.importType, status: "UPLOADED", sourceAttachmentId: current.id,
        sourceSha256: current.sha256!, originalFilename: current.originalFilename, sheetName: selectedSheet, createdByPersonId: input.actor.personId,
        resultJson: { sheets } } });
      await tx.attachmentLink.create({ data: { attachmentId: current.id, entityType: "IMPORT_BATCH", entityId: created.id, relationType: "SOURCE_FILE", createdByPersonId: input.actor.personId } });
      await tx.attachment.update({ where: { id: current.id }, data: { isTemporary: false, permissionLevel: "SENSITIVE_PARENT" } });
      await tx.auditLog.create({ data: { actorPersonId: input.actor.personId, actorAccountId: input.actor.accountId, actionCode: "IMPORT_BATCH_CREATED", entityType: "IMPORT_BATCH", entityId: created.id,
        afterJson: { importType: created.importType, sourceAttachmentId: current.id, sheetCount: sheets.length }, requestId: input.context?.requestId, ip: input.context?.ip, device: input.context?.deviceName } });
      return created;
    });
    if (!selectedSheet) {
      await this.repository.prisma.importBatch.update({ where: { id: batch.id }, data: { status: "MAPPING_REQUIRED" } });
      return this.detail({ ...input, batchId: batch.id });
    }
    const headers = await readHeaders(buffer, selectedSheet);
    const automatic = autoMapHeaders(body.importType, headers);
    await this.repository.prisma.importBatch.update({ where: { id: batch.id }, data: { mappingJson: automatic.mapping as unknown as Prisma.InputJsonObject,
      status: automatic.missingRequiredFields.length ? "MAPPING_REQUIRED" : "UPLOADED" } });
    if (!automatic.missingRequiredFields.length) {
      try { await this.stagePreview(batch.id, automatic.mapping, selectedSheet, 1, "UPLOADED"); }
      catch (error) { await this.markFailed({ ...input, batchId: batch.id }, error, ["UPLOADED"], 1); throw error; }
    }
    const completed = await this.repository.prisma.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
    this.logBatch("import_batch_previewed", { batchId: completed.id, importType: completed.importType, status: completed.status, rowCount: completed.rowCount });
    return this.detail({ ...input, batchId: batch.id });
  }

  async list(input: ServiceInput & { query: { importType?: "ENTERPRISE" | "MEMBER" | "TALENT"; status?: ImportBatch["status"]; page: number; pageSize: number } }) {
    await this.authorize(input);
    return this.repository.list(input.query);
  }

  async detail(input: ServiceInput & { batchId: string }) {
    await this.authorize(input);
    const batch = await this.repository.findBatch(input.batchId);
    if (!batch) throw new ImportExportError("IMPORT_NOT_FOUND", "导入批次不存在");
    return { ...batch, rows: batch.rows.map(publicRow) };
  }

  async template(input: ServiceInput & { importType: "ENTERPRISE" | "MEMBER" | "TALENT" }) {
    await this.authorize(input);
    return { buffer: await buildImportTemplate(input.importType), filename: `${input.importType.toLowerCase()}-import-template.xlsx` };
  }

  async resultWorkbook(input: ServiceInput & { batchId: string }) {
    await this.authorize(input);
    const batch = await this.repository.findBatch(input.batchId);
    if (!batch) throw new ImportExportError("IMPORT_NOT_FOUND", "导入批次不存在");
    if (!new Set(["PREVIEW_READY", "SUCCEEDED", "FAILED"]).has(batch.status)) throw new ImportExportError("IMPORT_STATE_CONFLICT", "当前批次尚无可下载的结果报告");
    return { buffer: await buildImportResultWorkbook({ importType: batch.importType, rows: batch.rows }), filename: `import-${batch.id}-result.xlsx` };
  }

  async updateMapping(input: ServiceInput & { batchId: string; body: unknown }) {
    await this.authorize(input);
    const body = importMappingSchema.parse(input.body);
    const current = await this.repository.prisma.importBatch.findUnique({ where: { id: input.batchId } });
    if (!current) throw new ImportExportError("IMPORT_NOT_FOUND", "导入批次不存在");
    const mapping: ImportMapping = { importType: current.importType, ...body };
    const validation = validateMapping(mapping);
    if (!validation.valid) throw new ImportExportError("IMPORT_MAPPING_INVALID", "字段映射不完整或存在重复目标", validation);
    const nextVersion = await this.repository.transaction(async (tx) => {
      await this.repository.lockBatch(tx, input.batchId).catch(() => { throw new ImportExportError("IMPORT_NOT_FOUND", "导入批次不存在"); });
      const batch = await tx.importBatch.findUniqueOrThrow({ where: { id: input.batchId } });
      if (!["UPLOADED", "MAPPING_REQUIRED", "PREVIEW_READY"].includes(batch.status)) throw new ImportExportError("IMPORT_STATE_CONFLICT", "当前批次不能修改映射");
      const next = batch.mappingVersion + 1;
      await tx.importRow.deleteMany({ where: { batchId: batch.id } });
      await tx.importBatch.update({ where: { id: batch.id }, data: { status: "PARSING", sheetName: body.sheetName, mappingJson: mapping as unknown as Prisma.InputJsonObject,
        mappingVersion: next, rowCount: 0, validRowCount: 0, blockingRowCount: 0, warningRowCount: 0 } });
      await tx.auditLog.create({ data: { actorPersonId: input.actor.personId, actorAccountId: input.actor.accountId, actionCode: "IMPORT_MAPPING_UPDATED", entityType: "IMPORT_BATCH", entityId: batch.id,
        afterJson: { mappingVersion: next, sheetName: body.sheetName }, requestId: input.context?.requestId, ip: input.context?.ip, device: input.context?.deviceName } });
      return next;
    });
    try { await this.stagePreview(input.batchId, mapping, body.sheetName, nextVersion, "PARSING"); }
    catch (error) { await this.markFailed(input, error, ["PARSING"], nextVersion); throw error; }
    return this.detail(input);
  }

  async selectSheet(input: ServiceInput & { batchId: string; body: unknown }) {
    await this.authorize(input);
    const body = selectImportSheetSchema.parse(input.body);
    const batch = await this.repository.prisma.importBatch.findUnique({ where: { id: input.batchId } });
    if (!batch) throw new ImportExportError("IMPORT_NOT_FOUND", "导入批次不存在");
    if (batch.status !== "MAPPING_REQUIRED" || batch.sheetName) throw new ImportExportError("IMPORT_STATE_CONFLICT", "当前批次不需要选择 Sheet");
    const buffer = await this.readSource(batch);
    const sheets = await inspectWorkbook(buffer).catch(() => { throw new ImportExportError("IMPORT_FILE_INVALID", "xlsx 工作簿无法读取"); });
    if (!sheets.some(({ name }) => name === body.sheetName)) throw new ImportExportError("IMPORT_FILE_INVALID", "指定 Sheet 不存在");
    const headers = await readHeaders(buffer, body.sheetName);
    const automatic = autoMapHeaders(batch.importType, headers);
    const nextVersion = await this.repository.transaction(async (tx) => {
      await this.repository.lockBatch(tx, batch.id);
      const current = await tx.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
      if (current.status !== "MAPPING_REQUIRED" || current.sheetName) throw new ImportExportError("IMPORT_STATE_CONFLICT", "Sheet 已被其他管理员选择");
      const next = current.mappingVersion + 1;
      await tx.importBatch.update({ where: { id: batch.id }, data: { sheetName: body.sheetName, mappingJson: automatic.mapping as unknown as Prisma.InputJsonObject,
        mappingVersion: next, status: automatic.missingRequiredFields.length ? "MAPPING_REQUIRED" : "UPLOADED" } });
      await tx.auditLog.create({ data: { actorPersonId: input.actor.personId, actorAccountId: input.actor.accountId, actionCode: "IMPORT_MAPPING_UPDATED", entityType: "IMPORT_BATCH", entityId: batch.id,
        afterJson: { mappingVersion: next, sheetName: body.sheetName, automatic: true }, requestId: input.context?.requestId, ip: input.context?.ip, device: input.context?.deviceName } });
      return next;
    });
    if (!automatic.missingRequiredFields.length) {
      try { await this.stagePreview(batch.id, automatic.mapping, body.sheetName, nextVersion, "UPLOADED"); }
      catch (error) { await this.markFailed(input, error, ["UPLOADED"], nextVersion); throw error; }
    }
    return this.detail(input);
  }

  async resolveRow(input: ServiceInput & { batchId: string; rowId: string; body: unknown }) {
    await this.authorize(input);
    const body = resolveImportRowSchema.parse(input.body);
    return this.repository.transaction(async (tx) => {
      await this.repository.lockBatch(tx, input.batchId).catch(() => { throw new ImportExportError("IMPORT_NOT_FOUND", "导入批次不存在"); });
      await this.repository.lockRow(tx, input.rowId).catch(() => { throw new ImportExportError("IMPORT_NOT_FOUND", "导入行不存在"); });
      const batch = await tx.importBatch.findUniqueOrThrow({ where: { id: input.batchId } });
      const row = await tx.importRow.findUnique({ where: { id: input.rowId } });
      if (!row || row.batchId !== batch.id) throw new ImportExportError("IMPORT_NOT_FOUND", "导入行不存在");
      if (batch.status !== "PREVIEW_READY" || !["NEEDS_REVIEW", "BLOCKED", "RESOLVED"].includes(row.resolutionStatus)) throw new ImportExportError("IMPORT_STATE_CONFLICT", "当前导入行不能人工处理");
      const registry = importFieldRegistry(batch.importType);
      const allowed = new Set(registry.map(({ field }) => field));
      const corrections = body.normalizedValues ?? {};
      if (Object.keys(corrections).some((field) => !allowed.has(field))) throw new ImportExportError("IMPORT_ROW_RESOLUTION_INVALID", "修正包含未开放的导入字段");
      let normalized = { ...jsonRecord(row.normalizedJson), ...corrections };
      let issuesJson = (row.issuesJson ?? []) as Prisma.InputJsonValue;
      let candidateJson: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput = row.candidateJson === null ? Prisma.JsonNull : row.candidateJson as Prisma.InputJsonValue;
      let fingerprint = row.rowFingerprint;
      let reviewedMatchedEntityId: string | undefined;
      if (body.action !== "SKIP") {
        const allRows = await tx.importRow.findMany({ where: { batchId: batch.id }, orderBy: { rowNumber: "asc" } });
        const parsedRows: ParsedImportRow[] = allRows.map((currentRow) => {
          const currentValues = jsonRecord(currentRow.normalizedJson);
          const canonical = Object.fromEntries(registry.map(({ field }) => [field, currentValues[field] ?? ""]));
          if (currentRow.id === row.id) Object.assign(canonical, corrections);
          const priorIssues = Array.isArray(currentRow.issuesJson) ? currentRow.issuesJson as Array<{ code?: string; field?: string; severity?: "ERROR" | "WARNING" | "REVIEW"; message?: string }> : [];
          const inputIssues = priorIssues.filter(({ code, field }) => ["IMPORT_IDENTITY_FORMULA_BLOCKED", "IMPORT_FORMULA_CACHED_VALUE", "IMPORT_CELL_TOO_LONG", "IMPORT_HIGH_PRIVILEGE_COLUMN_IGNORED"].includes(code ?? "")
            && (currentRow.id !== row.id || !field || !(field in corrections)))
            .map(({ code, field, severity, message }) => ({ code: code!, field, severity: severity!, message: message! }));
          for (const definition of registry) if (definition.required && !canonical[definition.field]?.trim()) inputIssues.push({ code: "IMPORT_REQUIRED_FIELD_MISSING", field: definition.field, severity: "ERROR", message: `${definition.label}不能为空` });
          return { rowNumber: currentRow.rowNumber, raw: {}, normalized: canonical, formulaFields: [], issues: inputIssues };
        });
        const reviewed = (await buildPreviewRows(tx, batch.importType, batch.mappingVersion, parsedRows)).find(({ rowNumber }) => rowNumber === row.rowNumber)!;
        const reviewedIssues = reviewed.issuesJson as unknown as Array<{ code?: string; severity?: string }>;
        const unresolved = reviewedIssues.filter(({ code, severity }) => severity === "ERROR" || (severity === "REVIEW" && !EXPLICIT_IDENTITY_REVIEW_CODES.has(code ?? "")));
        if (unresolved.length) throw new ImportExportError("IMPORT_ROW_RESOLUTION_INVALID", "修正后仍有字段错误或未解决的正式数据映射");
        if (body.action === "CREATE" && reviewed.matchedEntityId && ["UPDATE", "LINK_EXISTING"].includes(reviewed.action)) throw new ImportExportError("IMPORT_ROW_RESOLUTION_INVALID", "修正后已精确匹配正式对象，不能重复创建");
        const reviewedCandidateIds = reviewed.candidateJson && Array.isArray(reviewed.candidateJson.candidateIds) ? reviewed.candidateJson.candidateIds.filter((id): id is string => typeof id === "string") : [];
        reviewedMatchedEntityId = reviewed.matchedEntityId;
        if (body.action === "LINK_EXISTING" && reviewedCandidateIds.length > 0 && !reviewedCandidateIds.includes(body.matchedEntityId!)) throw new ImportExportError("IMPORT_ROW_RESOLUTION_INVALID", "选择的对象不在当前匹配候选中");
        normalized = reviewed.normalizedJson as unknown as JsonRecord;
        issuesJson = reviewed.issuesJson as Prisma.InputJsonValue;
        candidateJson = reviewed.candidateJson ? reviewed.candidateJson as Prisma.InputJsonValue : Prisma.JsonNull;
        fingerprint = reviewed.rowFingerprint;
      }
      if (body.action === "LINK_EXISTING") {
        const exists = batch.importType === "ENTERPRISE" ? await tx.enterprise.count({ where: { id: body.matchedEntityId, status: "NORMAL" } })
          : batch.importType === "MEMBER" ? await tx.person.count({ where: { id: body.matchedEntityId, personStatus: "ACTIVE" } }) : await tx.talent.count({ where: { id: body.matchedEntityId, status: { not: "MERGED" } } });
        if (exists !== 1) throw new ImportExportError("IMPORT_ROW_RESOLUTION_INVALID", "选择的正式对象不存在或治理状态不允许通过导入处理");
      }
      const resolution = { action: body.action, matchedEntityId: body.matchedEntityId, correctedFields: Object.keys(corrections), reason: body.reason };
      await tx.importRow.update({ where: { id: row.id }, data: { normalizedJson: normalized as Prisma.InputJsonObject, action: body.action,
        resolutionStatus: "RESOLVED", matchedEntityId: body.matchedEntityId ?? reviewedMatchedEntityId ?? null, candidateJson, issuesJson,
        rowFingerprint: fingerprint, resolutionJson: resolution } });
      const blocking = await tx.importRow.count({ where: { batchId: batch.id, id: { not: row.id }, resolutionStatus: { in: ["NEEDS_REVIEW", "BLOCKED"] } } });
      await tx.importBatch.update({ where: { id: batch.id }, data: { previewVersion: { increment: 1 }, blockingRowCount: blocking, validRowCount: batch.rowCount - blocking } });
      await tx.auditLog.create({ data: { actorPersonId: input.actor.personId, actorAccountId: input.actor.accountId, actionCode: "IMPORT_ROW_RESOLVED", entityType: "IMPORT_ROW", entityId: row.id,
        afterJson: { batchId: batch.id, rowNumber: row.rowNumber, action: body.action, correctedFields: Object.keys(corrections) }, reason: body.reason,
        requestId: input.context?.requestId, ip: input.context?.ip, device: input.context?.deviceName } });
      return { rowId: row.id, previewVersion: batch.previewVersion + 1, blockingRowCount: blocking };
    });
  }

  async cancel(input: ServiceInput & { batchId: string }) {
    await this.authorize(input);
    return this.repository.transaction(async (tx) => {
      await this.repository.lockBatch(tx, input.batchId).catch(() => { throw new ImportExportError("IMPORT_NOT_FOUND", "导入批次不存在"); });
      const batch = await tx.importBatch.findUniqueOrThrow({ where: { id: input.batchId } });
      if (!["UPLOADED", "MAPPING_REQUIRED", "PREVIEW_READY", "FAILED"].includes(batch.status)) throw new ImportExportError("IMPORT_STATE_CONFLICT", "当前批次不能取消");
      const updated = await tx.importBatch.update({ where: { id: batch.id }, data: { status: "CANCELED" } });
      await tx.auditLog.create({ data: { actorPersonId: input.actor.personId, actorAccountId: input.actor.accountId, actionCode: "IMPORT_BATCH_CANCELED", entityType: "IMPORT_BATCH", entityId: batch.id,
        beforeJson: { status: batch.status }, afterJson: { status: "CANCELED" }, requestId: input.context?.requestId, ip: input.context?.ip, device: input.context?.deviceName } });
      return updated;
    });
  }

  private async applyRow(tx: ImportTransaction, batch: ImportBatch, row: ImportRow, input: ServiceInput, preparedPasswordHash: string | undefined,
    createdEnterprises: Map<string, string>, createdPeople: Map<string, string>) {
    const value = jsonRecord(row.normalizedJson);
    const reason = `批量导入 ${batch.id} 第 ${row.rowNumber} 行`;
    if (row.action === "SKIP") return { action: "SKIP" as const };
    if (["INVALID", "MANUAL_REVIEW"].includes(row.action) || ["BLOCKED", "NEEDS_REVIEW"].includes(row.resolutionStatus)) throw new ImportExportError("IMPORT_BLOCKING_ROWS", "仍有未解决的阻断行");
    if (batch.importType === "ENTERPRISE") {
      let entityId = row.matchedEntityId ?? (value.creditCode ? createdEnterprises.get(value.creditCode) : undefined);
      const core = { name: value.name, responsibleAreaId: value.responsibleAreaId, address: value.address, creditCode: value.creditCode || undefined,
        legalRepresentative: value.legalRepresentative || undefined, introduction: value.introduction || undefined, mainProducts: value.mainProducts,
        qualificationsHonors: value.qualificationsHonors || undefined, tagIds: [] };
      let action: "CREATE" | "UPDATE" | "LINK";
      if (!entityId && row.action === "CREATE") {
        const created = await this.enterprise.createFromImportInTransaction(tx, { ...input, enterprise: core, reason });
        entityId = created.id; action = "CREATE";
        await tx.importApplySnapshot.create({ data: { batchId: batch.id, entityType: "ENTERPRISE", createdEntityId: entityId } });
        if (value.creditCode) createdEnterprises.set(value.creditCode, entityId);
      } else {
        if (!entityId) throw new ImportExportError("IMPORT_ROW_RESOLUTION_INVALID", "企业关联目标不存在");
        const before = await tx.enterprise.findUnique({ where: { id: entityId } });
        if (!before) throw new ImportExportError("IMPORT_ROW_RESOLUTION_INVALID", "企业关联目标不存在");
        if (before.status !== "NORMAL") throw new ImportExportError("IMPORT_DISABLED_ENTERPRISE_REQUIRES_GOVERNANCE", "停用或已合并企业不能通过导入更新，请先完成企业治理");
        await tx.importApplySnapshot.create({ data: { batchId: batch.id, entityType: "ENTERPRISE", entityId, beforeJson: { id: before.id, name: before.name, responsibleAreaId: before.responsibleAreaId, address: before.address, creditCode: before.creditCode, currentVersion: before.currentVersion } } });
        if (row.action === "UPDATE" || (row.action === "LINK_EXISTING" && row.matchedEntityId)) {
          await this.enterprise.updateFromImportInTransaction(tx, { ...input, enterpriseId: entityId, changes: { ...core, tagIds: undefined }, reason }); action = "UPDATE";
        } else action = "LINK";
      }
      if (value.contactName || value.contactPhone) {
        if (!value.contactName || !value.contactPhone) throw new ImportExportError("IMPORT_ROW_RESOLUTION_INVALID", "企业联系人姓名和电话必须同时填写");
        const exists = await tx.enterpriseContact.findFirst({ where: { enterpriseId: entityId, name: value.contactName, phone: value.contactPhone, status: "ACTIVE" } });
        if (!exists) await this.enterprise.createContactFromImportInTransaction(tx, { ...input, enterpriseId: entityId, contact: { name: value.contactName, positionTitle: value.contactPosition || undefined, phone: value.contactPhone, setPrimary: yes(value.contactPrimary) } });
      }
      return { action, entityId };
    }
    if (batch.importType === "MEMBER") {
      let personId = row.matchedEntityId ?? createdPeople.get(value.phone);
      if (!personId && row.action === "CREATE") {
        const phone = normalizeImportPhone(value.phone);
        await this.repository.lockPersonPhoneIdentity(tx, phoneIdentityHash(phone));
        const currentCandidates = await this.repository.findPersonPhoneCandidatesForUpdate(tx, phone);
        const currentMatch = matchPerson({ name: value.name, phone }, currentCandidates);
        if (currentMatch.kind !== "CREATE") {
          throw new ImportExportError("IMPORT_IDENTITY_CONFLICT", "手机号身份在预览后发生变化，整批已回滚，请刷新预览后重试");
        }
      }
      const member: MemberImportWrite = { personId, name: value.name, phone: value.phone, batchId: value.batchId,
        memberKind: value.memberKindCode as MemberImportWrite["memberKind"], dispatchOrganizationId: value.dispatchOrganizationId || undefined,
        postOrganizationId: value.postOrganizationId || undefined, positionTitle: value.positionTitle || undefined, startDate: toDate(value.startDate),
        endDate: value.endDate ? toDate(value.endDate) : undefined, professionalDirection: value.professionalDirection || undefined,
        coordinatableResources: value.coordinatableResources || undefined, createAccount: yes(value.createAccount), preparedPasswordHash };
      if (personId) {
        const before = await tx.person.findUnique({ where: { id: personId }, include: { account: { select: { id: true, status: true } }, batchMemberships: { where: { batchId: value.batchId } } } });
        if (!before) throw new ImportExportError("IMPORT_ROW_RESOLUTION_INVALID", "人员关联目标不存在");
        await tx.importApplySnapshot.create({ data: { batchId: batch.id, entityType: "PERSON", entityId: personId, beforeJson: { id: before.id, name: before.name, accountStatus: before.account?.status ?? null, membershipIds: before.batchMemberships.map(({ id }) => id) } } });
      }
      const applied = await this.member.applyImportInTransaction(tx, { ...input, member, reason });
      personId = applied.id;
      if (!member.personId) await tx.importApplySnapshot.create({ data: { batchId: batch.id, entityType: "PERSON", createdEntityId: personId } });
      createdPeople.set(value.phone, personId);
      return { action: member.personId ? "LINK" as const : "CREATE" as const, entityId: personId };
    }
    const core = { name: value.name, scopeType: value.scopeTypeCode, organizationName: value.organizationName, title: value.title,
      professionalDirection: value.professionalDirection, workEducationExperience: value.workEducationExperience || undefined,
      representativeAchievements: value.representativeAchievements || undefined, originalRecommenderPersonId: value.originalRecommenderPersonId };
    if (row.action === "CREATE" && !row.matchedEntityId) {
      const created = await this.talent.createFromImportInTransaction(tx, { ...input, talent: core, reason });
      await tx.importApplySnapshot.create({ data: { batchId: batch.id, entityType: "TALENT", createdEntityId: created.talent.id } });
      return { action: "CREATE" as const, entityId: created.talent.id };
    }
    if (!row.matchedEntityId) throw new ImportExportError("IMPORT_ROW_RESOLUTION_INVALID", "人才关联目标不存在");
    const before = await tx.talent.findUnique({ where: { id: row.matchedEntityId } });
    if (!before) throw new ImportExportError("IMPORT_ROW_RESOLUTION_INVALID", "人才关联目标不存在");
    await tx.importApplySnapshot.create({ data: { batchId: batch.id, entityType: "TALENT", entityId: before.id, beforeJson: { id: before.id, name: before.name, currentVersion: before.currentVersion } } });
    await this.talent.updateFromImportInTransaction(tx, { ...input, talentId: before.id, changes: core, reason });
    return { action: "LINK" as const, entityId: before.id };
  }

  async confirm(input: ServiceInput & { batchId: string; body: unknown; idempotencyKey: string | null }) {
    const startedAt = Date.now();
    await this.authorize(input);
    const body = confirmImportSchema.parse(input.body);
    const idempotencyKey = input.idempotencyKey?.trim();
    if (!idempotencyKey || idempotencyKey.length > 200) throw new ImportExportError("IMPORT_IDEMPOTENCY_CONFLICT", "必须提供有效 Idempotency-Key");
    const hashedKey = keyHash(idempotencyKey);
    const hashedPayload = payloadHash(input.batchId, body.expectedPreviewVersion, body.reason);
    const replay = await this.repository.prisma.importCommandIdempotency.findUnique({ where: { actorPersonId_action_keyHash: { actorPersonId: input.actor.personId, action: "CONFIRM", keyHash: hashedKey } } });
    if (replay) { if (replay.batchId !== input.batchId || replay.previewVersion !== body.expectedPreviewVersion || replay.payloadHash !== hashedPayload) throw new ImportExportError("IMPORT_IDEMPOTENCY_CONFLICT", "Idempotency-Key 已用于不同导入命令"); return replay.responseJson; }
    const preview = await this.repository.prisma.importBatch.findUnique({ where: { id: input.batchId }, include: { rows: { orderBy: { rowNumber: "asc" } } } });
    if (!preview) throw new ImportExportError("IMPORT_NOT_FOUND", "导入批次不存在");
    if (preview.previewVersion !== body.expectedPreviewVersion) throw new ImportExportError("IMPORT_PREVIEW_STALE", "预览版本已变化，请重新确认");
    if (preview.status !== "PREVIEW_READY") throw new ImportExportError("IMPORT_STATE_CONFLICT", "当前批次不能执行正式导入");
    if (preview.blockingRowCount !== 0 || preview.rows.some(({ resolutionStatus }) => ["BLOCKED", "NEEDS_REVIEW"].includes(resolutionStatus))) throw new ImportExportError("IMPORT_BLOCKING_ROWS", "仍有未解决的阻断行");
    const isTestEnvironment = ["test", "testing", "uat", "staging"].includes((process.env.APP_ENV ?? "").trim().toLowerCase());
    const preBackup = isTestEnvironment
      ? { id: null }
      : await this.backups.requestPreOperation({ actor: input.actor, context: input.context, type: "PRE_IMPORT", reason: body.reason, idempotencyKey: `import:${input.idempotencyKey}` });
    const prepared = new Map<string, string>();
    if (preview.importType === "MEMBER") {
      for (const row of preview.rows) {
        const value = jsonRecord(row.normalizedJson);
        if (row.action !== "SKIP" && yes(value.createAccount) && !prepared.has(value.phone)) prepared.set(value.phone, (await prepareInitialAccountCredential(value.phone)).passwordHash);
      }
    }
    try {
      const result = await this.repository.transaction(async (tx) => {
        await this.repository.lockBatch(tx, input.batchId).catch(() => { throw new ImportExportError("IMPORT_NOT_FOUND", "导入批次不存在"); });
        const existing = await tx.importCommandIdempotency.findUnique({ where: { actorPersonId_action_keyHash: { actorPersonId: input.actor.personId, action: "CONFIRM", keyHash: hashedKey } } });
        if (existing) {
          if (existing.batchId !== input.batchId || existing.previewVersion !== body.expectedPreviewVersion || existing.payloadHash !== hashedPayload) throw new ImportExportError("IMPORT_IDEMPOTENCY_CONFLICT", "Idempotency-Key 已用于不同导入命令");
          return existing.responseJson;
        }
        const batch = await tx.importBatch.findUniqueOrThrow({ where: { id: input.batchId }, include: { rows: { orderBy: { rowNumber: "asc" } }, sourceAttachment: true } });
        if (batch.previewVersion !== body.expectedPreviewVersion) throw new ImportExportError("IMPORT_PREVIEW_STALE", "预览版本已变化，请重新确认");
        if (batch.status !== "PREVIEW_READY") throw new ImportExportError("IMPORT_STATE_CONFLICT", "当前批次不能执行正式导入");
        if (batch.blockingRowCount !== 0 || batch.rows.some(({ resolutionStatus }) => ["BLOCKED", "NEEDS_REVIEW"].includes(resolutionStatus))) throw new ImportExportError("IMPORT_BLOCKING_ROWS", "仍有未解决的阻断行");
        if (batch.sourceAttachment.sha256 !== batch.sourceSha256 || batch.sourceAttachment.scanStatus !== "PASSED") throw new ImportExportError("IMPORT_FILE_INVALID", "源附件校验值或安全状态已变化");
        await tx.importBatch.update({ where: { id: batch.id }, data: { status: "APPLYING" } });
        const counts = { created: 0, updated: 0, linked: 0, skipped: 0, warnings: batch.warningRowCount, errors: 0 };
        const createdEnterprises = new Map<string, string>();
        const createdPeople = new Map<string, string>();
        for (const row of batch.rows) {
          const value = jsonRecord(row.normalizedJson);
          const result = await this.applyRow(tx, batch, row, input, prepared.get(value.phone), createdEnterprises, createdPeople);
          if (result.action === "CREATE") counts.created += 1;
          else if (result.action === "UPDATE") counts.updated += 1;
          else if (result.action === "LINK") counts.linked += 1;
          else counts.skipped += 1;
        }
        const response = { batchId: batch.id, status: "SUCCEEDED", sourceRows: batch.rowCount, ...counts, previewVersion: batch.previewVersion };
        await tx.importBatch.update({ where: { id: batch.id }, data: { status: "SUCCEEDED", appliedAt: new Date(), resultJson: response, errorCode: null, failedAt: null } });
        await tx.auditLog.create({ data: { actorPersonId: input.actor.personId, actorAccountId: input.actor.accountId, actionCode: "IMPORT_BATCH_APPLIED", entityType: "IMPORT_BATCH", entityId: batch.id,
          afterJson: { importType: batch.importType, rowCount: batch.rowCount, created: counts.created, updated: counts.updated, linked: counts.linked, skipped: counts.skipped, preBackupRecordId: preBackup.id }, reason: body.reason,
          requestId: input.context?.requestId, ip: input.context?.ip, device: input.context?.deviceName } });
        await tx.importCommandIdempotency.create({ data: { actorPersonId: input.actor.personId, action: "CONFIRM", keyHash: hashedKey, payloadHash: hashedPayload,
          batchId: batch.id, previewVersion: batch.previewVersion, responseJson: response } });
        return response;
      });
      this.logBatch("import_batch_applied", { batchId: input.batchId, importType: preview.importType, status: "SUCCEEDED", rowCount: preview.rowCount,
        createdCount: Number((result as { created?: number }).created ?? 0), updatedCount: Number((result as { updated?: number }).updated ?? 0),
        linkedCount: Number((result as { linked?: number }).linked ?? 0), skippedCount: Number((result as { skipped?: number }).skipped ?? 0), duration: Date.now() - startedAt });
      return result;
    } catch (error) {
      if (isIdempotencyUniqueViolation(error)) {
        const existing = await this.repository.prisma.importCommandIdempotency.findUnique({ where: { actorPersonId_action_keyHash: { actorPersonId: input.actor.personId, action: "CONFIRM", keyHash: hashedKey } } });
        if (existing && existing.batchId === input.batchId && existing.previewVersion === body.expectedPreviewVersion && existing.payloadHash === hashedPayload) return existing.responseJson;
        if (existing) throw new ImportExportError("IMPORT_IDEMPOTENCY_CONFLICT", "Idempotency-Key 已用于不同导入命令");
      }
      if (error instanceof ImportExportError && ["IMPORT_NOT_FOUND", "IMPORT_PREVIEW_STALE", "IMPORT_STATE_CONFLICT", "IMPORT_BLOCKING_ROWS", "IMPORT_IDEMPOTENCY_CONFLICT", "IMPORT_FILE_INVALID"].includes(error.code)) throw error;
      await this.markFailed(input, error, ["PREVIEW_READY"]);
      throw error;
    }
  }
}
