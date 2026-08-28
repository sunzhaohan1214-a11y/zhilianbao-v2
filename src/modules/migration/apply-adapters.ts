import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { createDemandFromLegacyInTransaction } from "@/modules/demand/migration";
import { EnterpriseService } from "@/modules/enterprise/enterprise-service";
import {
  matchEnterprise,
  matchPerson,
  matchPolicy,
  matchTalent,
  normalizeImportPhone,
} from "@/modules/entity-matching";
import { prepareInitialAccountCredential } from "@/modules/identity/account-service";
import { MemberService } from "@/modules/member-foundation/member-service";
import type { PermissionActor } from "@/modules/permissions/types";
import { createReimbursementFromLegacyInTransaction } from "@/modules/reimbursement/migration";
import { TalentService } from "@/modules/talent/talent-service";
import { mappedDemandStatus, mappedDemandType, mappedReimbursementStatus } from "./adapters";
import { MigrationError } from "./errors";
import { sourceFingerprint } from "./fingerprint";
import type { MigrationTransaction } from "./repository";
import type {
  LegacyEntityType,
  LegacyRecord,
  MigrationApplyAction,
  MigrationPreviewIssue,
  MigrationResolution,
} from "./types";

type ExistingMap = {
  targetEntity: string;
  targetId: string;
  sourceFingerprint: string;
  immutableHistory: boolean;
};

export type PendingMapping = {
  sourceEntity: string;
  sourceId: string;
  targetEntity: string;
  targetId: string;
  sourceFingerprint: string;
  immutableHistory: boolean;
};

export type AdapterResult = {
  action: MigrationApplyAction;
  targetEntity?: string;
  targetId?: string;
  immutableHistory?: boolean;
  issues: MigrationPreviewIssue[];
  mappings?: PendingMapping[];
};

export type ApplyAdapterContext = {
  tx: MigrationTransaction;
  actor: PermissionActor;
  sourceSystem: string;
  snapshotAt: Date;
  resolution?: MigrationResolution;
  existingMap?: ExistingMap;
  currentFingerprint: string;
  preparedPasswordHash?: string;
  validatedAttachmentShaByParent: ReadonlyMap<string, string>;
};

const TARGET_ENTITY: Record<LegacyEntityType, string> = {
  ORGANIZATION: "ORGANIZATION",
  PERSON: "PERSON",
  ENTERPRISE: "ENTERPRISE",
  TALENT: "TALENT",
  POLICY: "POLICY",
  DEMAND: "DEMAND",
  PRESENCE: "PRESENCE_REPORT",
  TRIP: "TRIP",
  VISIT: "ENTERPRISE_VISIT",
  REIMBURSEMENT: "REIMBURSEMENT",
  HELP: "HELP_REQUEST",
  ANNOUNCEMENT: "ANNOUNCEMENT",
  ROLE: "ROLE_ASSIGNMENT",
};

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function issue(
  record: LegacyRecord,
  code: string,
  severity: MigrationPreviewIssue["severity"],
  message: string,
  field?: string,
  candidates?: string[],
): MigrationPreviewIssue {
  return { sourceEntity: record.entityType, sourceId: record.sourceId, code, severity, message, field, candidates, sourceSnapshot: record.payload };
}

function businessNo(prefix: string, sourceId: string): string {
  return `${prefix}-${createHash("sha256").update(sourceId).digest("hex").slice(0, 20).toUpperCase()}`;
}

function phoneIdentityHash(phone: string): string {
  return createHash("sha256").update(`PHONE:${normalizeImportPhone(phone)}`).digest("hex");
}

function resolutionApplied(record: LegacyRecord, resolution: MigrationResolution): MigrationPreviewIssue {
  return issue(record, "MIGRATION_RESOLUTION_APPLIED", "WARNING", `已应用 ${resolution.action} resolution：${resolution.reason}`);
}

async function sourceTarget(
  tx: MigrationTransaction,
  sourceSystem: string,
  sourceEntity: string,
  sourceId: string,
  targetEntity: string,
): Promise<string | undefined> {
  const mapping = await tx.legacyMigrationMap.findUnique({
    where: { sourceSystem_sourceEntity_sourceId: { sourceSystem, sourceEntity, sourceId } },
  });
  return mapping?.targetEntity === targetEntity ? mapping.targetId : undefined;
}

async function targetExists(tx: MigrationTransaction, targetEntity: string, targetId: string): Promise<boolean> {
  switch (targetEntity) {
    case "PERSON": return Boolean(await tx.person.findUnique({ where: { id: targetId } }));
    case "ORGANIZATION": return Boolean(await tx.organization.findUnique({ where: { id: targetId } }));
    case "ENTERPRISE": return Boolean(await tx.enterprise.findUnique({ where: { id: targetId } }));
    case "TALENT": return Boolean(await tx.talent.findUnique({ where: { id: targetId } }));
    case "POLICY": return Boolean(await tx.policy.findUnique({ where: { id: targetId } }));
    case "DEMAND": return Boolean(await tx.demand.findUnique({ where: { id: targetId } }));
    case "DEMAND_PROGRESS": return Boolean(await tx.demandProgress.findUnique({ where: { id: targetId } }));
    case "REIMBURSEMENT": return Boolean(await tx.reimbursement.findUnique({ where: { id: targetId } }));
    case "HELP_REQUEST": return Boolean(await tx.helpRequest.findUnique({ where: { id: targetId } }));
    case "ANNOUNCEMENT": return Boolean(await tx.announcement.findUnique({ where: { id: targetId } }));
    case "ATTACHMENT": return Boolean(await tx.attachment.findUnique({ where: { id: targetId } }));
    default: return false;
  }
}

export async function validateResolutionLink(
  tx: MigrationTransaction,
  record: LegacyRecord,
  resolution: MigrationResolution,
): Promise<AdapterResult | undefined> {
  if (resolution.action !== "LINK") return undefined;
  const expected = TARGET_ENTITY[record.entityType];
  if (resolution.targetEntity !== expected || !resolution.targetId || !await targetExists(tx, expected, resolution.targetId)) {
    return { action: "REVIEW", targetEntity: expected, issues: [issue(record, "MIGRATION_RESOLUTION_TARGET_INVALID", "REVIEW", "LINK resolution 目标不存在或实体类型不一致")] };
  }
  if (expected === "PERSON") {
    const target = await tx.person.findUniqueOrThrow({ where: { id: resolution.targetId } });
    if (target.personStatus === "ARCHIVED") return { action: "REVIEW", targetEntity: expected, issues: [issue(record, "PERSON_ARCHIVED_REQUIRES_GOVERNANCE", "REVIEW", "ARCHIVED Person 不能通过 resolution 恢复或关联")] };
  }
  if (expected === "ENTERPRISE") {
    const target = await tx.enterprise.findUniqueOrThrow({ where: { id: resolution.targetId } });
    if (target.status !== "NORMAL") return { action: "REVIEW", targetEntity: expected, issues: [issue(record, "ENTERPRISE_GOVERNANCE_REQUIRED", "REVIEW", "DISABLED/MERGED Enterprise 不能通过 resolution 绕过治理")] };
  }
  if (record.entityType === "ROLE") return { action: "REVIEW", targetEntity: expected, issues: [issue(record, "HIGH_PRIVILEGE_SOURCE_EVIDENCE_REQUIRED", "REVIEW", "角色不得通过通用 resolution 赋予")] };
  return { action: "LINK", targetEntity: expected, targetId: resolution.targetId, issues: [resolutionApplied(record, resolution)] };
}

export class MigrationAdapterRegistry {
  private readonly member = new MemberService();
  private readonly enterprise = new EnterpriseService();
  private readonly talent = new TalentService();

  async prepare(record: LegacyRecord): Promise<string | undefined> {
    if (record.entityType !== "PERSON" || record.payload.accountEligible !== true || record.payload.currentEmploymentConfirmed !== true || !record.payload.phone) return undefined;
    return (await prepareInitialAccountCredential(String(record.payload.phone))).passwordHash;
  }

  async apply(record: LegacyRecord, context: ApplyAdapterContext): Promise<AdapterResult> {
    if (context.existingMap) {
      if (!await targetExists(context.tx, context.existingMap.targetEntity, context.existingMap.targetId)) {
        throw new MigrationError("MIGRATION_TARGET_MISSING", "既有迁移 Map 指向的 V2 目标不存在");
      }
      if (context.existingMap.sourceFingerprint !== context.currentFingerprint) {
        if (context.existingMap.immutableHistory) {
          throw new MigrationError("MIGRATION_SOURCE_HISTORY_CHANGED", "不可变历史源记录内容发生变化，禁止覆盖");
        }
        if (record.entityType === "DEMAND") await this.assertDemandProgressHistoryUnchanged(record, context);
        return {
          action: "REVIEW",
          targetEntity: context.existingMap.targetEntity,
          targetId: context.existingMap.targetId,
          immutableHistory: context.existingMap.immutableHistory,
          issues: [issue(record, "MIGRATION_SOURCE_CHANGED_REQUIRES_REVIEW", "REVIEW", "源记录已变化但当前 adapter 未实现可审计的正式 UPDATE；目标与旧 fingerprint 均保持不变")],
        };
      }
      return { action: "SKIP", targetEntity: context.existingMap.targetEntity, targetId: context.existingMap.targetId, immutableHistory: context.existingMap.immutableHistory, issues: [] };
    }
    if (context.resolution?.action === "SKIP") {
      return { action: "SKIP", targetEntity: TARGET_ENTITY[record.entityType], issues: [resolutionApplied(record, context.resolution)] };
    }
    if (context.resolution?.action === "WAIVE") {
      return { action: "REVIEW", targetEntity: TARGET_ENTITY[record.entityType], issues: [issue(record, "MIGRATION_RESOLUTION_WAIVE_NOT_APPLICABLE", "REVIEW", "WAIVE 只记录 lineage，不能绕过实体治理或制造成功结果")] };
    }
    if (context.resolution) {
      const linked = await validateResolutionLink(context.tx, record, context.resolution);
      if (linked) return linked;
    }
    switch (record.entityType) {
      case "ORGANIZATION": return this.organization(record, context);
      case "PERSON": return this.person(record, context);
      case "ENTERPRISE": return this.enterpriseRecord(record, context);
      case "TALENT": return this.talentRecord(record, context);
      case "POLICY": return this.policy(record, context);
      case "DEMAND": return this.demand(record, context);
      case "REIMBURSEMENT": return this.reimbursement(record, context);
      case "HELP": return this.help(record, context);
      case "ANNOUNCEMENT": return this.announcement(record, context);
      case "PRESENCE":
      case "TRIP":
      case "VISIT":
      case "ROLE":
        return { action: "REVIEW", targetEntity: TARGET_ENTITY[record.entityType], immutableHistory: true, issues: [issue(record, "MIGRATION_APPLY_UNSUPPORTED", "REVIEW", `${record.entityType} 当前 schema 缺少可证明安全的历史写入表示`)] };
    }
  }

  private async assertDemandProgressHistoryUnchanged(record: LegacyRecord, context: ApplyAdapterContext): Promise<void> {
    const targetProgressIds = (await context.tx.demandProgress.findMany({ where: { demandId: context.existingMap!.targetId }, select: { id: true } })).map(({ id }) => id);
    if (targetProgressIds.length === 0) return;
    const existingProgressMaps = await context.tx.legacyMigrationMap.findMany({ where: { sourceSystem: context.sourceSystem, targetEntity: "DEMAND_PROGRESS", targetId: { in: targetProgressIds } } });
    const currentProgress = new Map((record.payload.progress as Array<Record<string, unknown>>).map((value) => [String(value.sourceId), value]));
    for (const mapping of existingProgressMaps) {
      const source = currentProgress.get(mapping.sourceId);
      if (!source || mapping.sourceFingerprint !== sourceFingerprint(source)) {
        throw new MigrationError("MIGRATION_SOURCE_HISTORY_CHANGED", "不可变 DemandProgress 源历史发生变化，禁止覆盖");
      }
    }
  }

  private async organization(record: LegacyRecord, { tx, actor }: ApplyAdapterContext): Promise<AdapterResult> {
    const type = record.payload.organizationType === "TOWNSHIP" ? "TOWNSHIP_ORG" : String(record.payload.organizationType);
    const matches = await tx.organization.findMany({ where: { name: String(record.payload.name), type: type as "TOWNSHIP_ORG" | "DEPARTMENT" | "DISPATCH_UNIT" | "POST_UNIT", status: "ACTIVE" } });
    if (matches.length > 1) return { action: "REVIEW", targetEntity: "ORGANIZATION", issues: [issue(record, "ORGANIZATION_IDENTITY_AMBIGUOUS", "REVIEW", "组织名称和类型命中多条记录")] };
    if (matches[0]) return { action: "LINK", targetEntity: "ORGANIZATION", targetId: matches[0].id, issues: [] };
    const created = await tx.organization.create({ data: { name: String(record.payload.name), type: type as "TOWNSHIP_ORG" | "DEPARTMENT" | "DISPATCH_UNIT" | "POST_UNIT", status: record.payload.status === "INACTIVE" ? "INACTIVE" : "ACTIVE" } });
    await tx.auditLog.create({ data: { actorPersonId: actor.personId, actorAccountId: actor.accountId, actionCode: "ORGANIZATION_IMPORTED_FROM_V1", entityType: "ORGANIZATION", entityId: created.id, afterJson: json(record.payload), reason: "V1 migration" } });
    return { action: "CREATE", targetEntity: "ORGANIZATION", targetId: created.id, issues: [] };
  }

  private async person(record: LegacyRecord, context: ApplyAdapterContext): Promise<AdapterResult> {
    const { tx, actor } = context;
    const phone = record.payload.phone ? normalizeImportPhone(String(record.payload.phone)) : "";
    if (!phone) return { action: "REVIEW", targetEntity: "PERSON", issues: [issue(record, "PERSON_PHONE_MISSING", "REVIEW", "手机号缺失，不能安全自动判定人员身份")] };
    await tx.$executeRaw`INSERT INTO person_import_identity_locks (phone_hash) VALUES (${phoneIdentityHash(phone)}) ON DUPLICATE KEY UPDATE phone_hash = ${phoneIdentityHash(phone)}`;
    await tx.$queryRaw`SELECT phone_hash FROM person_import_identity_locks WHERE phone_hash = ${phoneIdentityHash(phone)} FOR UPDATE`;
    const people = await tx.person.findMany({ include: { account: true } });
    const match = matchPerson({ name: String(record.payload.name), phone }, people.map((person) => ({ id: person.id, name: person.name, phone: person.account?.phone ?? person.contactPhone, personStatus: person.personStatus, accountStatus: person.account?.status ?? null })));
    if (match.kind === "INVALID" || match.kind === "REVIEW") return { action: "REVIEW", targetEntity: "PERSON", issues: match.issues.map((value) => issue(record, value.code, value.severity === "ERROR" ? "BLOCKER" : value.severity, value.message, value.field, value.candidateIds)) };
    if (match.kind === "EXACT") return { action: "LINK", targetEntity: "PERSON", targetId: match.matchedEntityId, issues: [] };
    const isCurrent = record.payload.memberKind === "CURRENT" && record.payload.currentEmploymentConfirmed === true;
    if (!isCurrent) {
      const created = await tx.person.create({ data: { name: String(record.payload.name), contactPhone: phone } });
      await tx.auditLog.create({ data: { actorPersonId: actor.personId, actorAccountId: actor.accountId, actionCode: "PERSON_IMPORTED_FROM_V1", entityType: "PERSON", entityId: created.id, afterJson: { sourceId: record.sourceId, historical: true }, reason: "V1 historical person only" } });
      return { action: "CREATE", targetEntity: "PERSON", targetId: created.id, issues: [] };
    }
    const batches = await tx.batch.findMany({ where: { name: String(record.payload.batchName ?? ""), status: "ACTIVE" } });
    if (batches.length !== 1 || !record.payload.startDate) return { action: "REVIEW", targetEntity: "PERSON", issues: [issue(record, "PERSON_ACTIVE_BATCH_UNRESOLVED", "REVIEW", "current 人员无法唯一匹配合法 active batch")] };
    const created = await this.member.applyImportInTransaction(tx, { actor, member: { name: String(record.payload.name), phone, batchId: batches[0].id, memberKind: "CURRENT", startDate: new Date(`${record.payload.startDate}T00:00:00+08:00`), createAccount: record.payload.accountEligible === true, preparedPasswordHash: context.preparedPasswordHash }, reason: "V1 migration" });
    return { action: "CREATE", targetEntity: "PERSON", targetId: created.id, issues: [] };
  }

  private async enterpriseRecord(record: LegacyRecord, context: ApplyAdapterContext): Promise<AdapterResult> {
    const { tx, actor, resolution } = context;
    const areas = await tx.administrativeArea.findMany({ where: { name: String(record.payload.responsibleAreaName), status: "ACTIVE", type: { in: ["TOWNSHIP", "PARK", "HIGH_TECH_ZONE", "DEVELOPMENT_ZONE"] } } });
    if (areas.length !== 1) return { action: "REVIEW", targetEntity: "ENTERPRISE", issues: [issue(record, "ENTERPRISE_AREA_UNRESOLVED", "REVIEW", "负责区域无法唯一映射 V2 AdministrativeArea")] };
    const candidates = await tx.enterprise.findMany({ select: { id: true, name: true, responsibleAreaId: true, creditCode: true, status: true } });
    const match = matchEnterprise({ name: String(record.payload.name), responsibleAreaId: areas[0].id, creditCode: record.payload.creditCode ? String(record.payload.creditCode) : undefined }, candidates);
    if (match.kind === "INVALID" || match.kind === "REVIEW") return { action: "REVIEW", targetEntity: "ENTERPRISE", issues: match.issues.map((value) => issue(record, value.code, value.severity === "ERROR" ? "BLOCKER" : value.severity, value.message, value.field, value.candidateIds)) };
    if (match.kind === "EXACT") return { action: "LINK", targetEntity: "ENTERPRISE", targetId: match.matchedEntityId, issues: [] };
    if (!record.payload.creditCode && resolution?.action !== "CREATE") return { action: "REVIEW", targetEntity: "ENTERPRISE", issues: [issue(record, "ENTERPRISE_NO_CODE_REQUIRES_REVIEW", "REVIEW", "无信用代码企业必须由明确 CREATE resolution 才能建档")] };
    const created = await this.enterprise.createFromImportInTransaction(tx, { actor, enterprise: { name: String(record.payload.name), responsibleAreaId: areas[0].id, address: String(record.payload.address), creditCode: record.payload.creditCode ? String(record.payload.creditCode) : undefined, legalRepresentative: record.payload.legalRepresentative ? String(record.payload.legalRepresentative) : undefined, introduction: record.payload.introduction ? String(record.payload.introduction) : undefined, mainProducts: String(record.payload.mainProducts), tagIds: [] }, reason: "V1 migration" });
    const issues: MigrationPreviewIssue[] = resolution ? [resolutionApplied(record, resolution)] : [];
    if (record.payload.primaryContactConfirmed === true && record.payload.contactName && record.payload.contactPhone) {
      await this.enterprise.createContactFromImportInTransaction(tx, { actor, enterpriseId: created.id, contact: { name: String(record.payload.contactName), phone: String(record.payload.contactPhone), setPrimary: true } });
    } else if (record.payload.contactName || record.payload.contactPhone) {
      issues.push(issue(record, "ENTERPRISE_PRIMARY_CONTACT_UNCONFIRMED", "REVIEW", "未确认联系人不写入 primary contact"));
    }
    return { action: "CREATE", targetEntity: "ENTERPRISE", targetId: created.id, issues };
  }

  private async talentRecord(record: LegacyRecord, { tx, actor, sourceSystem }: ApplyAdapterContext): Promise<AdapterResult> {
    const candidates = await tx.talent.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true, organizationName: true, professionalDirection: true } });
    const match = matchTalent({ name: String(record.payload.name), organizationName: String(record.payload.organizationName), professionalDirection: String(record.payload.professionalDirection) }, candidates);
    if (match.kind !== "CREATE") return { action: "REVIEW", targetEntity: "TALENT", issues: match.issues.map((value) => issue(record, value.code, "REVIEW", value.message, value.field, value.candidateIds)) };
    const recommenderId = record.payload.recommenderSourceId ? await sourceTarget(tx, sourceSystem, "PERSON", String(record.payload.recommenderSourceId), "PERSON") : undefined;
    if (!recommenderId) return { action: "REVIEW", targetEntity: "TALENT", issues: [issue(record, "TALENT_RECOMMENDER_UNRESOLVED", "REVIEW", "推荐人必须由 Person map 或合法 LINK resolution 解析")] };
    const created = await this.talent.createFromImportInTransaction(tx, { actor, talent: { name: String(record.payload.name), scopeType: String(record.payload.scopeType), organizationName: String(record.payload.organizationName), title: String(record.payload.title), professionalDirection: String(record.payload.professionalDirection), originalRecommenderPersonId: recommenderId }, reason: "V1 migration" });
    await tx.talent.update({ where: { id: created.talent.id }, data: { sourceSystem, sourceRecordId: record.sourceId } });
    return { action: "CREATE", targetEntity: "TALENT", targetId: created.talent.id, issues: record.payload.resumeTextContactDetected === true ? [issue(record, "TALENT_CONTACT_EXTRACTION_PROHIBITED", "WARNING", "简历电话/邮箱未结构化写入人才档案")] : [] };
  }

  private async policy(record: LegacyRecord, context: ApplyAdapterContext): Promise<AdapterResult> {
    const { tx, actor } = context;
    const sourceAttachmentSha = context.validatedAttachmentShaByParent.get(`POLICY:${record.sourceId}`);
    if (!sourceAttachmentSha || sourceAttachmentSha !== record.payload.primaryFileSha256) return { action: "REVIEW", targetEntity: "POLICY", issues: [issue(record, "POLICY_PRIMARY_FILE_UNRESOLVED", "REVIEW", "政策主文件未通过 source 校验，不能创建成功结果")] };
    const policies = await tx.policy.findMany({ include: { currentVersion: true } });
    const candidates = policies.flatMap((policy) => {
      const snapshot = policy.currentVersion?.snapshotJson as Record<string, unknown> | null;
      const digest = snapshot?.primaryFileSha256;
      return typeof digest === "string" ? [{ id: policy.id, title: policy.title, publishingDepartment: policy.issuingDepartment, publishedDate: policy.publicationDate.toISOString().slice(0, 10), primaryFileSha256: digest }] : [];
    });
    const match = matchPolicy({ title: String(record.payload.title), publishingDepartment: String(record.payload.publishingDepartment), publishedDate: String(record.payload.publishedDate), primaryFileSha256: String(record.payload.primaryFileSha256) }, candidates);
    if (match.kind === "EXACT") return { action: "LINK", targetEntity: "POLICY", targetId: match.matchedEntityId, issues: [] };
    if (match.kind !== "CREATE") return { action: "REVIEW", targetEntity: "POLICY", issues: match.issues.map((value) => issue(record, value.code, "REVIEW", value.message, value.field, value.candidateIds)) };
    const publicationStatus = record.payload.status === "WITHDRAWN" ? "WITHDRAWN" : "PUBLISHED";
    const policy = await tx.policy.create({ data: { title: String(record.payload.title), issuingDepartment: String(record.payload.publishingDepartment), publicationDate: new Date(`${record.payload.publishedDate}T00:00:00+08:00`), level: "V1_LEGACY", publicationStatus, effectStatus: record.payload.status === "REPLACED" ? "REPLACED" : "CURRENT", createdByPersonId: actor.personId, publishedAt: publicationStatus === "PUBLISHED" ? context.snapshotAt : undefined, withdrawnAt: publicationStatus === "WITHDRAWN" ? context.snapshotAt : undefined } });
    const version = await tx.policyContentVersion.create({ data: { policyId: policy.id, versionNo: 1, snapshotJson: json({ ...record.payload, primaryFileSha256: sourceAttachmentSha, sourceSystem: context.sourceSystem }), changeReason: "V1 migration", changedByPersonId: actor.personId, coreFieldsConfirmedAt: context.snapshotAt, coreFieldsConfirmedById: actor.personId } });
    await tx.policy.update({ where: { id: policy.id }, data: { currentVersionId: version.id } });
    await tx.auditLog.create({ data: { actorPersonId: actor.personId, actorAccountId: actor.accountId, actionCode: "POLICY_IMPORTED_FROM_V1", entityType: "POLICY", entityId: policy.id, afterJson: json(record.payload), reason: "V1 migration" } });
    return { action: "CREATE", targetEntity: "POLICY", targetId: policy.id, issues: [] };
  }

  private async demand(record: LegacyRecord, context: ApplyAdapterContext): Promise<AdapterResult> {
    const { tx, actor, sourceSystem, existingMap, resolution } = context;
    const enterpriseId = await sourceTarget(tx, sourceSystem, "ENTERPRISE", String(record.payload.enterpriseSourceId), "ENTERPRISE");
    if (!enterpriseId) return { action: "REVIEW", targetEntity: "DEMAND", issues: [issue(record, "DEMAND_ENTERPRISE_UNRESOLVED", "REVIEW", "需求企业尚无有效 Enterprise map")] };
    const enterprise = await tx.enterprise.findUnique({ where: { id: enterpriseId }, include: { primaryContact: true } });
    if (!enterprise || enterprise.status !== "NORMAL" || !enterprise.primaryContact) return { action: "REVIEW", targetEntity: "DEMAND", issues: [issue(record, "DEMAND_CONTACT_UNRESOLVED", "REVIEW", "需求必须绑定已确认的有效企业联系人")] };
    const batches = await tx.batch.findMany({ where: { isCurrent: true, status: "ACTIVE" } });
    if (batches.length !== 1) return { action: "REVIEW", targetEntity: "DEMAND", issues: [issue(record, "CURRENT_ACTIVE_BATCH_COUNT_INVALID", "REVIEW", "当前 active batch 不唯一")] };
    const ownerPersonId = record.payload.ownerPersonSourceId ? await sourceTarget(tx, sourceSystem, "PERSON", String(record.payload.ownerPersonSourceId), "PERSON") : undefined;
    if (record.payload.ownerPersonSourceId && !ownerPersonId) return { action: "REVIEW", targetEntity: "DEMAND", issues: [issue(record, "DEMAND_OWNER_UNRESOLVED", "REVIEW", "历史主责人员尚无有效 Person map")] };
    const issues: MigrationPreviewIssue[] = resolution ? [resolutionApplied(record, resolution)] : [];
    const progressInputs: Array<{ sourceId: string; content: string; occurredAt: Date; actorPersonId: string }> = [];
    const mappings: PendingMapping[] = [];
    for (const progress of record.payload.progress as Array<Record<string, unknown>>) {
      const progressMap = await tx.legacyMigrationMap.findUnique({ where: { sourceSystem_sourceEntity_sourceId: { sourceSystem, sourceEntity: "DEMAND_PROGRESS", sourceId: String(progress.sourceId) } } });
      if (progressMap) {
        mappings.push({ sourceEntity: "DEMAND_PROGRESS", sourceId: String(progress.sourceId), targetEntity: "DEMAND_PROGRESS", targetId: progressMap.targetId, sourceFingerprint: sourceFingerprint(progress), immutableHistory: true });
        continue;
      }
      const progressActor = progress.actorPersonSourceId ? await sourceTarget(tx, sourceSystem, "PERSON", String(progress.actorPersonSourceId), "PERSON") : undefined;
      if (!progressActor || progressActor !== ownerPersonId) {
        issues.push(issue(record, "DEMAND_PROGRESS_ACTOR_UNRESOLVED", "REVIEW", "历史进展作者无法证明为当时主责，未写入进展", "progress.actorPersonSourceId"));
        continue;
      }
      progressInputs.push({ sourceId: String(progress.sourceId), content: String(progress.content), occurredAt: new Date(String(progress.occurredAt)), actorPersonId: progressActor });
    }
    if (!existingMap && issues.some((value) => value.severity === "REVIEW") && resolution?.action !== "CREATE") return { action: "REVIEW", targetEntity: "DEMAND", issues };
    let demandId = existingMap?.targetId;
    let createdProgresses: Array<{ id: string }> = [];
    if (demandId) {
      if (!await tx.demand.findUnique({ where: { id: demandId } })) throw new MigrationError("MIGRATION_TARGET_MISSING", "既有 Demand map 指向目标不存在");
      for (const progress of progressInputs) createdProgresses.push(await tx.demandProgress.create({ data: { demandId, currentProgress: progress.content, nextStep: "历史迁移记录，无可靠下一步", createdByPersonId: progress.actorPersonId, sourceType: "CURRENT_OWNER", createdAt: progress.occurredAt } }));
    } else {
      const created = await createDemandFromLegacyInTransaction(tx, { actorPersonId: actor.personId, actorAccountId: actor.accountId, businessNo: businessNo("V1D", record.sourceId), sourceSystem, sourceId: record.sourceId, sourceSnapshot: json(record.payload), snapshotAt: context.snapshotAt, title: String(record.payload.title).slice(0, 200), description: String(record.payload.description), demandType: mappedDemandType(record.payload.legacyType ? String(record.payload.legacyType) : undefined), status: mappedDemandStatus(String(record.payload.legacyStatus)), enterpriseId, responsibleAreaId: enterprise.responsibleAreaId, selectedContactId: enterprise.primaryContact.id, contactSnapshot: { enterpriseName: enterprise.name, contactName: enterprise.primaryContact.name, contactPhone: enterprise.primaryContact.phone }, batchId: batches[0].id, ownerPersonId, progresses: progressInputs });
      demandId = created.demand.id;
      createdProgresses = created.progresses;
    }
    mappings.push(...progressInputs.map((progress, index) => ({ sourceEntity: "DEMAND_PROGRESS", sourceId: progress.sourceId, targetEntity: "DEMAND_PROGRESS", targetId: createdProgresses[index].id, sourceFingerprint: sourceFingerprint((record.payload.progress as Array<Record<string, unknown>>).find((value) => value.sourceId === progress.sourceId)), immutableHistory: true })));
    if (record.payload.legacyStatus === "已解决") issues.push(issue(record, "DEMAND_LEGACY_COMPLETED_NO_OUTCOME", "WARNING", "历史 COMPLETED 未创建 CloseRequest、CloseReview 或 Outcome"));
    return { action: existingMap ? "SKIP" : "CREATE", targetEntity: "DEMAND", targetId: demandId, immutableHistory: record.payload.legacyStatus === "已解决", issues, mappings };
  }

  private async reimbursement(record: LegacyRecord, context: ApplyAdapterContext): Promise<AdapterResult> {
    const applicantPersonId = await sourceTarget(context.tx, context.sourceSystem, "PERSON", String(record.payload.applicantPersonSourceId), "PERSON");
    if (!applicantPersonId) return { action: "REVIEW", targetEntity: "REIMBURSEMENT", issues: [issue(record, "REIMBURSEMENT_APPLICANT_UNRESOLVED", "REVIEW", "报销申请人尚无有效 Person map")] };
    const created = await createReimbursementFromLegacyInTransaction(context.tx, { actorPersonId: context.actor.personId, actorAccountId: context.actor.accountId, applicantPersonId, businessNo: businessNo("V1R", record.sourceId), sourceSystem: context.sourceSystem, sourceId: record.sourceId, type: String(record.payload.type) as "TRAVEL" | "ACTIVITY", reason: String(record.payload.reason), status: mappedReimbursementStatus(String(record.payload.legacyStatus)), totalAmount: String(record.payload.totalAmount), snapshotAt: context.snapshotAt });
    return { action: "CREATE", targetEntity: "REIMBURSEMENT", targetId: created.id, immutableHistory: record.payload.legacyStatus === "已通过", issues: record.payload.legacyStatus === "已通过" ? [issue(record, "REIMBURSEMENT_LEGACY_VERIFIED_TERMINAL", "WARNING", "V1 已通过映射只读终态")] : [] };
  }

  private async help(record: LegacyRecord, context: ApplyAdapterContext): Promise<AdapterResult> {
    if (record.payload.status !== "待受理") return { action: "REVIEW", targetEntity: "HELP_REQUEST", immutableHistory: record.payload.status === "已办结", issues: [issue(record, "MIGRATION_APPLY_UNSUPPORTED", "REVIEW", "处理中/已办结 Help 缺少可靠 owner、expectedCompleteAt 或 completedAt，未写目标记录")] };
    const submitterPersonId = await sourceTarget(context.tx, context.sourceSystem, "PERSON", String(record.payload.submitterPersonSourceId), "PERSON");
    if (!submitterPersonId) return { action: "REVIEW", targetEntity: "HELP_REQUEST", issues: [issue(record, "HELP_SUBMITTER_UNRESOLVED", "REVIEW", "求助提交人尚无有效 Person map")] };
    const created = await context.tx.helpRequest.create({ data: { businessNo: businessNo("V1H", record.sourceId), submitterPersonId, category: "OTHER", title: String(record.payload.title), description: String(record.payload.description), status: "PENDING", sourceSystem: context.sourceSystem, sourceRecordId: record.sourceId } });
    await context.tx.stateTransitionHistory.create({ data: { entityType: "HELP_REQUEST", entityId: created.id, toState: "PENDING", actionCode: "HELP_IMPORTED_FROM_V1", actorPersonId: context.actor.personId, metadataJson: json({ legacyCategory: record.payload.legacyCategory }) } });
    await context.tx.auditLog.create({ data: { actorPersonId: context.actor.personId, actorAccountId: context.actor.accountId, actionCode: "HELP_IMPORTED_FROM_V1", entityType: "HELP_REQUEST", entityId: created.id, afterJson: json(record.payload), reason: "V1 migration" } });
    return { action: "CREATE", targetEntity: "HELP_REQUEST", targetId: created.id, issues: [issue(record, "HELP_CATEGORY_MAPPED_TO_OTHER", "WARNING", "旧类别映射 OTHER，原值保留在迁移审计")] };
  }

  private async announcement(record: LegacyRecord, context: ApplyAdapterContext): Promise<AdapterResult> {
    const publishedAt = record.payload.publishedAt ? new Date(String(record.payload.publishedAt)) : undefined;
    const announcement = await context.tx.announcement.create({ data: { status: publishedAt ? "PUBLISHED" : "DRAFT", publishedAt, createdByPersonId: context.actor.personId } });
    const version = await context.tx.announcementVersion.create({ data: { announcementId: announcement.id, versionNo: 1, title: String(record.payload.title).slice(0, 200), body: String(record.payload.body), needConfirm: false, reason: "V1 migration", createdByPersonId: context.actor.personId, createdAt: publishedAt ?? context.snapshotAt } });
    await context.tx.announcement.update({ where: { id: announcement.id }, data: { currentVersionId: version.id } });
    await context.tx.auditLog.create({ data: { actorPersonId: context.actor.personId, actorAccountId: context.actor.accountId, actionCode: "ANNOUNCEMENT_IMPORTED_FROM_V1", entityType: "ANNOUNCEMENT", entityId: announcement.id, afterJson: { sourceId: record.sourceId, status: publishedAt ? "PUBLISHED" : "DRAFT" }, reason: "V1 migration" } });
    return { action: "CREATE", targetEntity: "ANNOUNCEMENT", targetId: announcement.id, immutableHistory: true, issues: [issue(record, "ANNOUNCEMENT_CONFIRMATIONS_NOT_MIGRATED", "WARNING", "未伪造确认记录且未回放 Message/Todo/Outbox")] };
  }
}

export { TARGET_ENTITY, targetExists };
