import type { Prisma } from "@/generated/prisma/client";
import type { AuthRequestContext } from "@/modules/identity/request-context";
import { authorizeActor } from "@/modules/permissions/authorization";
import type { PermissionActor } from "@/modules/permissions/types";
import { writePolicyAudit, writePolicyTransition } from "./audit";
import { PolicyError } from "./errors";
import { FakePolicyExtractionAdapter, type PolicyExtractionAdapter, UnavailablePolicyExtractionAdapter } from "./extraction";
import { PolicyRepository, type PolicyTransaction } from "./repository/policy-repository";
import type { CreatePolicyInput, PolicyCoreInput, PolicyInterpretationInput } from "./schemas";

type ServiceInput = { actor: PermissionActor; context?: AuthRequestContext };
type VersionInput = CreatePolicyInput & { changeReason?: string };

function asDate(value: string | null | undefined) {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

function snapshot(input: CreatePolicyInput | (PolicyCoreInput & { content?: Record<string, unknown> }), interpretation?: PolicyInterpretationInput): Prisma.InputJsonObject {
  return {
    title: input.title,
    issuingDepartment: input.issuingDepartment,
    publicationDate: input.publicationDate,
    level: input.level,
    applicationDeadline: input.applicationDeadline ?? null,
    tagIds: input.tagIds,
    content: "content" in input ? input.content ?? {} : {},
    ...(interpretation ? { interpretation } : {}),
  } as Prisma.InputJsonObject;
}

function normalizePolicy<T extends { tagRelations: Array<{ tag: { id: string; name: string } }> }>(policy: T) {
  const { tagRelations, ...rest } = policy;
  return { ...rest, tags: tagRelations.map(({ tag }) => tag) };
}

export class PolicyService {
  constructor(
    private readonly repository = new PolicyRepository(),
    private readonly extraction: PolicyExtractionAdapter = process.env.APP_ENV === "test" ? new FakePolicyExtractionAdapter() : new UnavailablePolicyExtractionAdapter(),
  ) {}

  async list(input: ServiceInput & { query: { keyword?: string; level?: string; tagId?: string; effectStatus?: "CURRENT" | "REPLACED"; publicationStatus?: "DRAFT" | "PUBLISHED" | "WITHDRAWN"; page: number; pageSize: number } }) {
    await authorizeActor({ actor: input.actor, action: "policy.view", resource: { resourceType: "policy", requiredScope: "GLOBAL_PUBLISHED" } });
    const canGovern = input.actor.capabilities.has("policy.edit");
    const publicationStatus = canGovern ? input.query.publicationStatus ?? "PUBLISHED" : "PUBLISHED";
    const result = await this.repository.list({ ...input.query, publicationStatus });
    return { ...result, items: result.items.map(normalizePolicy) };
  }

  async formOptions(input: ServiceInput) {
    await authorizeActor({ actor: input.actor, action: "policy.view", resource: { resourceType: "policy", requiredScope: "GLOBAL_PUBLISHED" } });
    const [tags, levels] = await Promise.all([this.repository.listTags(), this.repository.listLevels()]);
    return { tags, levels: levels.map(({ level }) => level) };
  }

  async detail(input: ServiceInput & { policyId: string }) {
    await authorizeActor({ actor: input.actor, action: "policy.view", resource: { resourceType: "policy", requiredScope: "GLOBAL_PUBLISHED" } });
    return this.repository.transaction(async (tx) => {
      const policy = await this.repository.findPolicy(tx, input.policyId);
      if (!policy) throw new PolicyError("POLICY_NOT_FOUND", "政策不存在", 404);
      const canGovern = input.actor.capabilities.has("policy.edit");
      if (policy.publicationStatus !== "PUBLISHED" && !canGovern) throw new PolicyError("POLICY_NOT_FOUND", "政策不存在", 404);
      const visibleVersions = canGovern ? policy.versions : policy.versions.filter(({ id }) => id === policy.currentVersionId);
      const links = await this.repository.findVersionLinks(tx, visibleVersions.map(({ id }) => id));
      const currentVersion = policy.currentVersion && !canGovern ? { ...policy.currentVersion, interpretations: [] } : policy.currentVersion;
      return normalizePolicy({ ...policy, currentVersion, versions: visibleVersions.map((version) => ({
        ...version,
        interpretations: canGovern ? version.interpretations : [],
        attachments: links.filter(({ entityId }) => entityId === version.id).map(({ attachment, relationType }) => ({
          id: attachment.id, filename: attachment.originalFilename, relationType, scanStatus: attachment.scanStatus,
        })),
      })) });
    });
  }

  async create(input: ServiceInput & { policy: CreatePolicyInput }) {
    await authorizeActor({ actor: input.actor, action: "policy.create", resource: { resourceType: "policy", requiredScope: "GLOBAL_OPERATIONAL" } });
    return this.repository.transaction(async (tx) => {
      await this.validateTags(tx, input.policy.tagIds);
      const policy = await tx.policy.create({ data: {
        title: input.policy.title, issuingDepartment: input.policy.issuingDepartment, publicationDate: asDate(input.policy.publicationDate)!,
        level: input.policy.level, applicationDeadline: asDate(input.policy.applicationDeadline), createdByPersonId: input.actor.personId,
      } });
      const version = await tx.policyContentVersion.create({ data: {
        policyId: policy.id, versionNo: 1, snapshotJson: snapshot(input.policy), changedByPersonId: input.actor.personId,
      } });
      await this.attachVersionFiles(tx, version.id, input.policy, input.actor.personId);
      await this.replaceTags(tx, policy.id, input.policy.tagIds);
      const updated = await tx.policy.update({ where: { id: policy.id }, data: { currentVersionId: version.id } });
      await writePolicyTransition(tx, { ...input, entityId: policy.id, toState: "DRAFT/CURRENT", actionCode: "POLICY_CREATED" });
      await writePolicyAudit(tx, { ...input, actionCode: "POLICY_CREATED", entityType: "POLICY", entityId: policy.id, after: { publicationStatus: "DRAFT", effectStatus: "CURRENT", versionNo: 1 } });
      return updated;
    });
  }

  async createVersion(input: ServiceInput & { policyId: string; version: VersionInput }) {
    await authorizeActor({ actor: input.actor, action: "policy.edit", resource: { resourceType: "policy", requiredScope: "GLOBAL_OPERATIONAL" } });
    return this.repository.transaction(async (tx) => {
      await this.lockPolicy(tx, input.policyId);
      const policy = await this.repository.findPolicy(tx, input.policyId);
      if (!policy) throw new PolicyError("POLICY_NOT_FOUND", "政策不存在", 404);
      if (policy.publicationStatus !== "DRAFT") throw new PolicyError("POLICY_STATE_CONFLICT", "只有草稿可建立新的待发布版本", 409);
      await this.validateTags(tx, input.version.tagIds);
      const versionNo = (policy.currentVersion?.versionNo ?? 0) + 1;
      const version = await tx.policyContentVersion.create({ data: {
        policyId: policy.id, versionNo, snapshotJson: snapshot(input.version), changeReason: input.version.changeReason,
        changedByPersonId: input.actor.personId,
      } });
      await this.attachVersionFiles(tx, version.id, input.version, input.actor.personId);
      await this.replaceTags(tx, policy.id, input.version.tagIds);
      await tx.policy.update({ where: { id: policy.id }, data: {
        title: input.version.title, issuingDepartment: input.version.issuingDepartment, publicationDate: asDate(input.version.publicationDate)!,
        level: input.version.level, applicationDeadline: asDate(input.version.applicationDeadline), currentVersionId: version.id,
      } });
      await writePolicyAudit(tx, { ...input, actionCode: "POLICY_VERSION_CREATED", entityType: "POLICY_CONTENT_VERSION", entityId: version.id, after: { policyId: policy.id, versionNo }, reason: input.version.changeReason });
      return version;
    });
  }

  async extract(input: ServiceInput & { policyId: string }) {
    await authorizeActor({ actor: input.actor, action: "policy.edit", resource: { resourceType: "policy", requiredScope: "GLOBAL_OPERATIONAL" } });
    const pending = await this.repository.transaction(async (tx) => {
      await this.lockPolicy(tx, input.policyId);
      const policy = await this.repository.findPolicy(tx, input.policyId);
      if (!policy?.currentVersion) throw new PolicyError("POLICY_VERSION_REQUIRED", "政策当前版本不存在", 409);
      if (policy.publicationStatus !== "DRAFT") throw new PolicyError("POLICY_STATE_CONFLICT", "只有草稿可执行智能提取", 409);
      const links = await this.repository.findVersionLinks(tx, [policy.currentVersion.id]);
      const primary = links.filter(({ relationType }) => relationType === "PRIMARY");
      if (primary.length !== 1 || primary[0].attachment.uploadStatus !== "UPLOADED" || primary[0].attachment.scanStatus !== "PASSED") {
        throw new PolicyError("POLICY_ATTACHMENT_NOT_READY", "主政策文件通过安全扫描后才能执行智能提取", 422);
      }
      const record = await tx.policyAIInterpretation.create({ data: {
        versionId: policy.currentVersion.id, provider: "pending", model: "pending", promptVersion: "policy-extract-v1",
      } });
      await writePolicyAudit(tx, { ...input, actionCode: "POLICY_AI_EXTRACTION_REQUESTED", entityType: "POLICY_AI_INTERPRETATION", entityId: record.id, after: { versionId: record.versionId, status: "PENDING" } });
      return { record, primaryAttachmentId: primary[0].attachmentId, supplementaryAttachmentIds: links.filter(({ relationType }) => relationType === "SUPPLEMENTARY").map(({ attachmentId }) => attachmentId) };
    });
    try {
      const result = await this.extraction.extract({ policyId: input.policyId, versionId: pending.record.versionId, primaryAttachmentId: pending.primaryAttachmentId, supplementaryAttachmentIds: pending.supplementaryAttachmentIds });
      return await this.repository.transaction((tx) => tx.policyAIInterpretation.update({ where: { id: pending.record.id }, data: {
        status: "COMPLETED", extractedJson: result.extracted as Prisma.InputJsonObject, evidenceJson: result.evidence as Prisma.InputJsonObject,
        provider: result.provider, model: result.model, promptVersion: result.promptVersion,
      } }));
    } catch (error) {
      const failureCode = typeof error === "object" && error && "code" in error ? String(error.code) : "POLICY_EXTRACTION_FAILED";
      return this.repository.transaction((tx) => tx.policyAIInterpretation.update({ where: { id: pending.record.id }, data: {
        status: "FAILED", provider: "unavailable", model: "unavailable", failureCode,
      } }));
    }
  }

  async confirmInterpretation(input: ServiceInput & { policyId: string; interpretationId?: string; core: PolicyCoreInput; interpretation: PolicyInterpretationInput }) {
    await authorizeActor({ actor: input.actor, action: "policy.edit", resource: { resourceType: "policy", requiredScope: "GLOBAL_OPERATIONAL" } });
    return this.repository.transaction(async (tx) => {
      await this.lockPolicy(tx, input.policyId);
      const policy = await this.repository.findPolicy(tx, input.policyId);
      if (!policy?.currentVersion) throw new PolicyError("POLICY_VERSION_REQUIRED", "政策当前版本不存在", 409);
      if (policy.publicationStatus !== "DRAFT") throw new PolicyError("POLICY_STATE_CONFLICT", "只有草稿可确认政策内容", 409);
      if (policy.currentVersion.coreFieldsConfirmedAt) throw new PolicyError("POLICY_VERSION_ALREADY_CONFIRMED", "当前版本已人工确认，如需修改请建立新内容版本", 409);
      await this.validateTags(tx, input.core.tagIds);
      const evidenceAttachmentIds = input.interpretation.evidence.flatMap(({ attachmentId }) => attachmentId ? [attachmentId] : []);
      if (evidenceAttachmentIds.length) {
        const links = await this.repository.findVersionLinks(tx, [policy.currentVersion.id]);
        const linkedAttachmentIds = new Set(links.map(({ attachmentId }) => attachmentId));
        if (evidenceAttachmentIds.some((attachmentId) => !linkedAttachmentIds.has(attachmentId))) {
          throw new PolicyError("POLICY_EVIDENCE_ATTACHMENT_INVALID", "原文依据附件必须属于当前政策版本", 422);
        }
      }
      if (input.interpretationId) {
        const ai = await tx.policyAIInterpretation.findUnique({ where: { id: input.interpretationId } });
        if (!ai || ai.versionId !== policy.currentVersion.id) throw new PolicyError("POLICY_INTERPRETATION_NOT_FOUND", "智能提取结果不存在", 404);
        if (ai.status !== "COMPLETED") throw new PolicyError("POLICY_INTERPRETATION_STATE_CONFLICT", "智能提取结果不可确认", 409);
        await tx.policyAIInterpretation.update({ where: { id: ai.id }, data: { status: "CONFIRMED", confirmedAt: new Date(), confirmedByPersonId: input.actor.personId } });
      }
      await this.replaceTags(tx, policy.id, input.core.tagIds);
      const confirmedAt = new Date();
      await tx.policy.update({ where: { id: policy.id }, data: {
        title: input.core.title, issuingDepartment: input.core.issuingDepartment, publicationDate: asDate(input.core.publicationDate)!,
        level: input.core.level, applicationDeadline: asDate(input.core.applicationDeadline),
      } });
      await tx.policyContentVersion.update({ where: { id: policy.currentVersion.id }, data: {
        snapshotJson: snapshot(input.core, input.interpretation), coreFieldsConfirmedAt: confirmedAt, coreFieldsConfirmedById: input.actor.personId,
      } });
      await writePolicyAudit(tx, { ...input, actionCode: "POLICY_AI_INTERPRETATION_CONFIRMED", entityType: "POLICY_CONTENT_VERSION", entityId: policy.currentVersion.id, after: { policyId: policy.id, interpretationId: input.interpretationId ?? null, manualConfirmation: !input.interpretationId } });
      return { policyId: policy.id, versionId: policy.currentVersion.id, confirmedAt };
    });
  }

  async publish(input: ServiceInput & { policyId: string }) {
    await authorizeActor({ actor: input.actor, action: "policy.publish", resource: { resourceType: "policy", requiredScope: "GLOBAL_OPERATIONAL" } });
    return this.repository.transaction(async (tx) => {
      await this.lockPolicy(tx, input.policyId);
      const policy = await this.repository.findPolicy(tx, input.policyId);
      if (!policy?.currentVersion) throw new PolicyError("POLICY_VERSION_REQUIRED", "政策当前版本不存在", 409);
      if (policy.publicationStatus !== "DRAFT") throw new PolicyError("POLICY_STATE_CONFLICT", "只有草稿可发布", 409);
      if (!policy.currentVersion.coreFieldsConfirmedAt) throw new PolicyError("POLICY_CONFIRMATION_REQUIRED", "发布前必须由管理员确认核心字段", 422);
      const links = await this.repository.findVersionLinks(tx, [policy.currentVersion.id]);
      if (links.filter(({ relationType }) => relationType === "PRIMARY").length !== 1) throw new PolicyError("POLICY_PRIMARY_ATTACHMENT_REQUIRED", "每个版本必须且只能有一个主政策文件", 422);
      if (links.some(({ attachment }) => attachment.uploadStatus !== "UPLOADED" || attachment.scanStatus !== "PASSED")) throw new PolicyError("POLICY_ATTACHMENT_NOT_READY", "所有政策附件必须通过安全扫描", 422);
      const updated = await tx.policy.update({ where: { id: policy.id }, data: { publicationStatus: "PUBLISHED", publishedAt: new Date() } });
      await writePolicyTransition(tx, { ...input, entityId: policy.id, fromState: `DRAFT/${policy.effectStatus}`, toState: `PUBLISHED/${policy.effectStatus}`, actionCode: "POLICY_PUBLISHED" });
      await writePolicyAudit(tx, { ...input, actionCode: "POLICY_PUBLISHED", entityType: "POLICY", entityId: policy.id, before: { publicationStatus: "DRAFT" }, after: { publicationStatus: "PUBLISHED" } });
      return updated;
    });
  }

  async withdraw(input: ServiceInput & { policyId: string; reason: string }) {
    await authorizeActor({ actor: input.actor, action: "policy.withdraw", resource: { resourceType: "policy", requiredScope: "GLOBAL_OPERATIONAL" } });
    return this.repository.transaction(async (tx) => {
      await this.lockPolicy(tx, input.policyId);
      const policy = await tx.policy.findUnique({ where: { id: input.policyId } });
      if (!policy) throw new PolicyError("POLICY_NOT_FOUND", "政策不存在", 404);
      if (policy.publicationStatus !== "PUBLISHED") throw new PolicyError("POLICY_STATE_CONFLICT", "只有已发布政策可撤回", 409);
      const updated = await tx.policy.update({ where: { id: policy.id }, data: { publicationStatus: "WITHDRAWN", withdrawnAt: new Date() } });
      await writePolicyTransition(tx, { ...input, entityId: policy.id, fromState: `PUBLISHED/${policy.effectStatus}`, toState: `WITHDRAWN/${policy.effectStatus}`, actionCode: "POLICY_WITHDRAWN", reason: input.reason });
      await writePolicyAudit(tx, { ...input, actionCode: "POLICY_WITHDRAWN", entityType: "POLICY", entityId: policy.id, before: { publicationStatus: "PUBLISHED", effectStatus: policy.effectStatus }, after: { publicationStatus: "WITHDRAWN", effectStatus: policy.effectStatus }, reason: input.reason });
      return updated;
    });
  }

  async createReplacement(input: ServiceInput & { newPolicyId: string; oldPolicyId: string; reason: string }) {
    await authorizeActor({ actor: input.actor, action: "policy.replacement.manage", resource: { resourceType: "policy", requiredScope: "GLOBAL_OPERATIONAL" } });
    if (input.newPolicyId === input.oldPolicyId) throw new PolicyError("POLICY_REPLACEMENT_INVALID", "政策不能替代自身", 422);
    return this.repository.transaction(async (tx) => {
      await this.repository.lockPolicies(tx, [input.oldPolicyId, input.newPolicyId]);
      const [oldPolicy, newPolicy] = await Promise.all([tx.policy.findUnique({ where: { id: input.oldPolicyId } }), tx.policy.findUnique({ where: { id: input.newPolicyId } })]);
      if (!oldPolicy || !newPolicy) throw new PolicyError("POLICY_NOT_FOUND", "政策不存在", 404);
      const active = await this.repository.findActiveReplacementRelations(tx);
      if (active.some((edge) => edge.oldPolicyId === oldPolicy.id)) throw new PolicyError("POLICY_REPLACEMENT_CONFLICT", "旧政策已有生效中的替代关系", 409);
      const graph = new Map<string, string[]>();
      for (const edge of active) graph.set(edge.oldPolicyId, [...(graph.get(edge.oldPolicyId) ?? []), edge.newPolicyId]);
      const pending = [newPolicy.id]; const seen = new Set<string>();
      while (pending.length) { const node = pending.pop()!; if (node === oldPolicy.id) throw new PolicyError("POLICY_REPLACEMENT_CYCLE", "替代关系不能形成环", 409); if (seen.has(node)) continue; seen.add(node); pending.push(...(graph.get(node) ?? [])); }
      if (oldPolicy.publicationStatus !== "PUBLISHED" || oldPolicy.effectStatus !== "CURRENT") throw new PolicyError("POLICY_REPLACEMENT_INVALID", "旧政策必须为已发布且现行政策", 422);
      if (newPolicy.publicationStatus !== "PUBLISHED" || newPolicy.effectStatus !== "CURRENT") throw new PolicyError("POLICY_REPLACEMENT_INVALID", "新政策必须为已发布且现行政策", 422);
      const relation = await tx.policyReplacementRelation.create({ data: { oldPolicyId: oldPolicy.id, newPolicyId: newPolicy.id, effectiveAt: new Date(), createdByPersonId: input.actor.personId, reason: input.reason } });
      await tx.policy.update({ where: { id: oldPolicy.id }, data: { effectStatus: "REPLACED" } });
      await tx.policy.update({ where: { id: newPolicy.id }, data: { effectStatus: "CURRENT" } });
      await writePolicyTransition(tx, { ...input, entityId: oldPolicy.id, fromState: `${oldPolicy.publicationStatus}/${oldPolicy.effectStatus}`, toState: `${oldPolicy.publicationStatus}/REPLACED`, actionCode: "POLICY_REPLACEMENT_CREATED", reason: input.reason, metadata: { relationId: relation.id, newPolicyId: newPolicy.id } });
      await writePolicyAudit(tx, { ...input, actionCode: "POLICY_REPLACEMENT_CREATED", entityType: "POLICY_REPLACEMENT", entityId: relation.id, after: { oldPolicyId: oldPolicy.id, newPolicyId: newPolicy.id }, reason: input.reason });
      return relation;
    });
  }

  async endReplacement(input: ServiceInput & { relationId: string; reason: string; restoreOldAsCurrent: boolean }) {
    await authorizeActor({ actor: input.actor, action: "policy.replacement.manage", resource: { resourceType: "policy", requiredScope: "GLOBAL_OPERATIONAL" } });
    return this.repository.transaction(async (tx) => {
      try { await this.repository.lockReplacement(tx, input.relationId); } catch { throw new PolicyError("POLICY_REPLACEMENT_NOT_FOUND", "替代关系不存在", 404); }
      const relation = await tx.policyReplacementRelation.findUnique({ where: { id: input.relationId } });
      if (!relation) throw new PolicyError("POLICY_REPLACEMENT_NOT_FOUND", "替代关系不存在", 404);
      await this.repository.lockPolicies(tx, [relation.oldPolicyId, relation.newPolicyId]);
      if (relation.endedAt) throw new PolicyError("POLICY_REPLACEMENT_CONFLICT", "替代关系已经结束", 409);
      const old = input.restoreOldAsCurrent ? await tx.policy.findUniqueOrThrow({ where: { id: relation.oldPolicyId } }) : null;
      if (old && old.publicationStatus !== "PUBLISHED") throw new PolicyError("POLICY_REPLACEMENT_RESTORE_INVALID", "撤回政策不能恢复为现行，请先核实正式政策状态", 409);
      const ended = await tx.policyReplacementRelation.update({ where: { id: relation.id }, data: { endedAt: new Date(), endedByPersonId: input.actor.personId, endReason: input.reason } });
      if (input.restoreOldAsCurrent) {
        await tx.policy.update({ where: { id: old!.id }, data: { effectStatus: "CURRENT" } });
        await writePolicyTransition(tx, { ...input, entityId: old!.id, fromState: `${old!.publicationStatus}/${old!.effectStatus}`, toState: `${old!.publicationStatus}/CURRENT`, actionCode: "POLICY_EFFECT_RESTORED", reason: input.reason, metadata: { relationId: relation.id } });
        await writePolicyAudit(tx, { ...input, actionCode: "POLICY_EFFECT_RESTORED", entityType: "POLICY", entityId: old!.id, before: { effectStatus: old!.effectStatus }, after: { effectStatus: "CURRENT" }, reason: input.reason });
      }
      await writePolicyAudit(tx, { ...input, actionCode: "POLICY_REPLACEMENT_ENDED", entityType: "POLICY_REPLACEMENT", entityId: relation.id, after: { restoreOldAsCurrent: input.restoreOldAsCurrent }, reason: input.reason });
      return ended;
    });
  }

  private async lockPolicy(tx: PolicyTransaction, policyId: string) {
    try { await this.repository.lockPolicy(tx, policyId); } catch { throw new PolicyError("POLICY_NOT_FOUND", "政策不存在", 404); }
  }

  private async validateTags(tx: PolicyTransaction, tagIds: readonly string[]) {
    if (new Set(tagIds).size !== tagIds.length) throw new PolicyError("POLICY_TAG_INVALID", "政策标签不能重复", 422);
    if (!tagIds.length) return;
    const count = await tx.policyTag.count({ where: { id: { in: [...tagIds] }, status: "ACTIVE" } });
    if (count !== tagIds.length) throw new PolicyError("POLICY_TAG_INVALID", "政策标签不存在或已停用", 422);
  }

  private async replaceTags(tx: PolicyTransaction, policyId: string, tagIds: readonly string[]) {
    await tx.policyTagRelation.deleteMany({ where: { policyId } });
    if (tagIds.length) await tx.policyTagRelation.createMany({ data: tagIds.map((tagId) => ({ policyId, tagId })) });
  }

  private async attachVersionFiles(tx: PolicyTransaction, versionId: string, input: Pick<CreatePolicyInput, "primaryAttachmentId" | "supplementaryAttachmentIds">, actorPersonId: string) {
    const ids = [input.primaryAttachmentId, ...input.supplementaryAttachmentIds];
    if (new Set(ids).size !== ids.length) throw new PolicyError("POLICY_ATTACHMENT_DUPLICATE", "主文件与补充附件不能重复", 422);
    if (!await this.repository.lockAttachments(tx, ids)) throw new PolicyError("POLICY_ATTACHMENT_NOT_READY", "政策附件不存在或已被其他业务使用", 422);
    const attachments = await tx.attachment.findMany({ where: { id: { in: ids } }, include: { links: true } });
    if (attachments.length !== ids.length || attachments.some((attachment) => attachment.uploadedByPersonId !== actorPersonId || !attachment.isTemporary || attachment.links.length > 0 || attachment.uploadStatus !== "UPLOADED" || !["PENDING", "SCANNING", "PASSED"].includes(attachment.scanStatus))) {
      throw new PolicyError("POLICY_ATTACHMENT_NOT_READY", "仅可关联本人本次上传且等待扫描或已通过扫描的临时附件", 422);
    }
    await tx.attachmentLink.create({ data: { attachmentId: input.primaryAttachmentId, entityType: "POLICY_CONTENT_VERSION", entityId: versionId, relationType: "PRIMARY", createdByPersonId: actorPersonId } });
    if (input.supplementaryAttachmentIds.length) await tx.attachmentLink.createMany({ data: input.supplementaryAttachmentIds.map((attachmentId) => ({ attachmentId, entityType: "POLICY_CONTENT_VERSION", entityId: versionId, relationType: "SUPPLEMENTARY", createdByPersonId: actorPersonId })) });
    await tx.attachment.updateMany({ where: { id: { in: ids } }, data: { isTemporary: false } });
  }
}
