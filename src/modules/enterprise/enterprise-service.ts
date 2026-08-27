import type {
  Enterprise,
  EnterpriseVersionChangeType,
  Prisma,
} from "@/generated/prisma/client";
import { authorizeActor } from "@/modules/permissions/authorization";
import type { PermissionActor } from "@/modules/permissions/types";
import { writeEnterpriseAudit, writeEnterpriseTransition, type EnterpriseMutationContext } from "./audit";
import { EnterpriseError, isPrismaUniqueConflict } from "./errors";
import { EnterpriseRepository, type EnterpriseTransaction } from "./repository/enterprise-repository";
import {
  createEnterpriseChangeRequestSchema,
  enterpriseCoreSchema,
  enterpriseFormalChangesSchema,
  resubmitEnterpriseChangeRequestSchema,
  type EnterpriseCoreInput,
  type EnterpriseFormalChanges,
} from "./schemas";

type ServiceInput = { actor: PermissionActor; context?: EnterpriseMutationContext };

function normalizeOptional(value: string | null | undefined): string | null | undefined {
  return value === undefined ? undefined : value === null || value === "" ? null : value;
}

function snapshotEnterprise(enterprise: Pick<Enterprise,
  "id" | "name" | "responsibleAreaId" | "address" | "creditCode" | "legalRepresentative"
  | "introduction" | "mainProducts" | "qualificationsHonors" | "latitude" | "longitude"
  | "geocodeStatus" | "status" | "mergedIntoId" | "primaryContactId" | "currentVersion"
>, tagIds: readonly string[] = []): Prisma.InputJsonObject {
  return {
    id: enterprise.id,
    name: enterprise.name,
    responsibleAreaId: enterprise.responsibleAreaId,
    address: enterprise.address,
    creditCode: enterprise.creditCode,
    legalRepresentative: enterprise.legalRepresentative,
    introduction: enterprise.introduction,
    mainProducts: enterprise.mainProducts,
    qualificationsHonors: enterprise.qualificationsHonors,
    latitude: enterprise.latitude?.toString() ?? null,
    longitude: enterprise.longitude?.toString() ?? null,
    geocodeStatus: enterprise.geocodeStatus,
    status: enterprise.status,
    mergedIntoId: enterprise.mergedIntoId,
    primaryContactId: enterprise.primaryContactId,
    currentVersion: enterprise.currentVersion,
    tagIds: [...tagIds],
  };
}

function publicEnterprise(enterprise: Awaited<ReturnType<EnterpriseRepository["findEnterprise"]>>) {
  if (!enterprise) return null;
  return {
    ...enterprise,
    latitude: enterprise.latitude?.toString() ?? null,
    longitude: enterprise.longitude?.toString() ?? null,
    tags: enterprise.tagRelations.map(({ tag }) => ({ id: tag.id, name: tag.name, status: tag.status })),
    tagRelations: undefined,
    versions: enterprise.versions.map((version) => ({ ...version, snapshotJson: version.snapshotJson })),
  };
}

export class EnterpriseService {
  constructor(private readonly repository = new EnterpriseRepository()) {}

  async formOptions(input: ServiceInput) {
    await authorizeActor({ actor: input.actor, action: "enterprise.view", resource: {
      resourceType: "enterprise", requiredScope: "GLOBAL_PUBLISHED",
    } });
    const options = await this.repository.listFormOptions();
    return {
      ...options,
      areas: input.actor.hasGlobalOperational
        ? options.areas
        : options.areas.filter((area) => input.actor.townshipAreaIds.includes(area.id)),
    };
  }

  private async requireArea(tx: EnterpriseTransaction, areaId: string): Promise<void> {
    if (!await this.repository.findArea(tx, areaId)) {
      throw new EnterpriseError("ENTERPRISE_AREA_INVALID", "企业所属区域不存在或已停用");
    }
  }

  private async requireTags(tx: EnterpriseTransaction, tagIds: readonly string[]): Promise<string[]> {
    const unique = [...new Set(tagIds)];
    if (unique.length === 0) return unique;
    const count = await tx.enterpriseTag.count({ where: { id: { in: unique }, status: "ACTIVE" } });
    if (count !== unique.length) throw new EnterpriseError("ENTERPRISE_STATE_CONFLICT", "包含不存在或已停用的企业标签");
    return unique;
  }

  private async setTags(tx: EnterpriseTransaction, enterpriseId: string, tagIds: readonly string[]): Promise<void> {
    const unique = await this.requireTags(tx, tagIds);
    await tx.enterpriseTagRelation.deleteMany({ where: { enterpriseId, tagId: { notIn: unique } } });
    if (unique.length > 0) {
      await tx.enterpriseTagRelation.createMany({
        data: unique.map((tagId) => ({ enterpriseId, tagId })),
        skipDuplicates: true,
      });
    }
  }

  private async createFormalInTransaction(
    tx: EnterpriseTransaction,
    input: EnterpriseCoreInput,
    service: ServiceInput,
    changeType: "CREATE" | "CHANGE_REQUEST_APPROVED",
    reason?: string,
  ) {
    await this.requireArea(tx, input.responsibleAreaId);
    const tagIds = await this.requireTags(tx, input.tagIds);
    const enterprise = await tx.enterprise.create({ data: {
      name: input.name,
      responsibleAreaId: input.responsibleAreaId,
      address: input.address,
      creditCode: input.creditCode,
      legalRepresentative: normalizeOptional(input.legalRepresentative),
      introduction: normalizeOptional(input.introduction),
      mainProducts: input.mainProducts,
      qualificationsHonors: normalizeOptional(input.qualificationsHonors),
      createdByPersonId: service.actor.personId,
      tagRelations: tagIds.length > 0 ? { createMany: { data: tagIds.map((tagId) => ({ tagId })) } } : undefined,
    } });
    const snapshot = snapshotEnterprise(enterprise, tagIds);
    await tx.enterpriseVersion.create({ data: {
      enterpriseId: enterprise.id,
      versionNo: 1,
      snapshotJson: snapshot,
      changeType,
      reason,
      changedByPersonId: service.actor.personId,
    } });
    await writeEnterpriseTransition(tx, {
      ...service,
      entityType: "ENTERPRISE",
      entityId: enterprise.id,
      toState: "NORMAL",
      actionCode: "ENTERPRISE_CREATED",
      reason,
    });
    await writeEnterpriseAudit(tx, {
      ...service,
      actionCode: "ENTERPRISE_CREATED",
      entityType: "ENTERPRISE",
      entityId: enterprise.id,
      after: snapshot,
      reason,
    });
    return enterprise;
  }

  async createFormal(input: ServiceInput & { enterprise: unknown }) {
    await authorizeActor({ actor: input.actor, action: "enterprise.create_formal", resource: {
      resourceType: "enterprise", requiredScope: "GLOBAL_OPERATIONAL",
    } });
    const enterpriseInput = enterpriseCoreSchema.parse(input.enterprise);
    try {
      return await this.repository.transaction((tx) => this.createFormalInTransaction(tx, enterpriseInput, input, "CREATE"));
    } catch (error) {
      if (isPrismaUniqueConflict(error)) throw new EnterpriseError("ENTERPRISE_DUPLICATE_CREDIT_CODE", "统一社会信用代码已存在");
      throw error;
    }
  }

  async list(input: ServiceInput & {
    query: { keyword?: string; areaId?: string; tagId?: string; status?: "NORMAL" | "DISABLED" | "MERGED"; contactPhone?: string; page: number; pageSize: number };
  }) {
    await authorizeActor({ actor: input.actor, action: "enterprise.view", resource: {
      resourceType: "enterprise", requiredScope: "GLOBAL_PUBLISHED",
    } });
    const adminQuery = input.query.status !== undefined || input.query.contactPhone !== undefined;
    if (adminQuery && !input.actor.hasGlobalOperational) {
      throw new EnterpriseError("ENTERPRISE_FORBIDDEN", "只有管理端可以筛选停用、合并状态或精确搜索联系人电话");
    }
    const result = await this.repository.listEnterprises({
      ...input.query,
      status: input.query.status ?? "NORMAL",
    });
    return {
      ...result,
      items: result.items.map((item) => ({
        ...item,
        tags: item.tagRelations.map(({ tag }) => tag),
        tagRelations: undefined,
      })),
    };
  }

  async detail(input: ServiceInput & { enterpriseId: string }) {
    await authorizeActor({ actor: input.actor, action: "enterprise.view", resource: {
      resourceType: "enterprise", requiredScope: "GLOBAL_PUBLISHED",
    } });
    const enterprise = await this.repository.transaction((tx) => this.repository.findEnterprise(tx, input.enterpriseId));
    if (!enterprise) throw new EnterpriseError("ENTERPRISE_NOT_FOUND", "企业不存在");
    return publicEnterprise(enterprise);
  }

  private async applyCorrection(
    tx: EnterpriseTransaction,
    enterpriseId: string,
    changes: EnterpriseFormalChanges,
    service: ServiceInput,
    reason: string,
    changeType: EnterpriseVersionChangeType,
    baseVersion?: number,
  ) {
    await this.repository.lockEnterprise(tx, enterpriseId);
    const current = await tx.enterprise.findUnique({ where: { id: enterpriseId }, include: { tagRelations: true } });
    if (!current) throw new EnterpriseError("ENTERPRISE_NOT_FOUND", "企业不存在");
    if (current.status === "MERGED") throw new EnterpriseError("ENTERPRISE_STATE_CONFLICT", "已合并企业为只读记录");
    if (baseVersion !== undefined && current.currentVersion !== baseVersion) {
      throw new EnterpriseError("ENTERPRISE_VERSION_CONFLICT", "企业版本已变化，请重新查看差异", {
        expectedVersion: baseVersion,
        currentVersion: current.currentVersion,
      });
    }
    if (changes.responsibleAreaId) await this.requireArea(tx, changes.responsibleAreaId);
    const nextTagIds = changes.tagIds === undefined ? current.tagRelations.map(({ tagId }) => tagId) : await this.requireTags(tx, changes.tagIds);
    const before = snapshotEnterprise(current, current.tagRelations.map(({ tagId }) => tagId));
    const scalarChanges = { ...changes };
    delete scalarChanges.tagIds;
    const updated = await tx.enterprise.update({ where: { id: enterpriseId }, data: {
      ...scalarChanges,
      legalRepresentative: normalizeOptional(scalarChanges.legalRepresentative),
      introduction: normalizeOptional(scalarChanges.introduction),
      qualificationsHonors: normalizeOptional(scalarChanges.qualificationsHonors),
      currentVersion: { increment: 1 },
    } });
    if (changes.tagIds !== undefined) await this.setTags(tx, enterpriseId, nextTagIds);
    const after = snapshotEnterprise(updated, nextTagIds);
    await tx.enterpriseVersion.create({ data: {
      enterpriseId,
      versionNo: updated.currentVersion,
      snapshotJson: after,
      changeType,
      reason,
      changedByPersonId: service.actor.personId,
    } });
    await writeEnterpriseAudit(tx, {
      ...service,
      actionCode: "ENTERPRISE_CORRECTED",
      entityType: "ENTERPRISE",
      entityId: enterpriseId,
      before,
      after,
      reason,
    });
    return updated;
  }

  async formalCorrection(input: ServiceInput & { enterpriseId: string; changes: unknown; reason: string; baseVersion?: number }) {
    await authorizeActor({ actor: input.actor, action: "enterprise.edit_formal", resource: {
      resourceType: "enterprise", requiredScope: "GLOBAL_OPERATIONAL",
    } });
    const changes = enterpriseFormalChangesSchema.parse(input.changes);
    try {
      return await this.repository.transaction((tx) => this.applyCorrection(
        tx, input.enterpriseId, changes, input, input.reason.trim(), "FORMAL_CORRECTION", input.baseVersion,
      ));
    } catch (error) {
      if (isPrismaUniqueConflict(error)) throw new EnterpriseError("ENTERPRISE_DUPLICATE_CREDIT_CODE", "统一社会信用代码已存在");
      throw error;
    }
  }

  private async changeStatus(input: ServiceInput & { enterpriseId: string; reason: string }, from: "NORMAL" | "DISABLED", to: "NORMAL" | "DISABLED") {
    await authorizeActor({ actor: input.actor, action: "enterprise.disable", resource: {
      resourceType: "enterprise", requiredScope: "GLOBAL_OPERATIONAL",
    } });
    const reason = input.reason.trim();
    return this.repository.transaction(async (tx) => {
      await this.repository.lockEnterprise(tx, input.enterpriseId);
      const current = await tx.enterprise.findUnique({ where: { id: input.enterpriseId }, include: { tagRelations: true } });
      if (!current) throw new EnterpriseError("ENTERPRISE_NOT_FOUND", "企业不存在");
      if (current.status !== from) throw new EnterpriseError("ENTERPRISE_STATE_CONFLICT", "企业当前状态不允许执行此操作");
      const before = snapshotEnterprise(current, current.tagRelations.map(({ tagId }) => tagId));
      const updated = await tx.enterprise.update({ where: { id: current.id }, data: { status: to, currentVersion: { increment: 1 } } });
      const after = snapshotEnterprise(updated, current.tagRelations.map(({ tagId }) => tagId));
      const action = to === "DISABLED" ? "ENTERPRISE_DISABLED" : "ENTERPRISE_RESTORED";
      await tx.enterpriseVersion.create({ data: {
        enterpriseId: current.id, versionNo: updated.currentVersion, snapshotJson: after,
        changeType: to === "DISABLED" ? "DISABLE" : "RESTORE", reason, changedByPersonId: input.actor.personId,
      } });
      await writeEnterpriseTransition(tx, { ...input, entityType: "ENTERPRISE", entityId: current.id, fromState: from, toState: to, actionCode: action, reason });
      await writeEnterpriseAudit(tx, { ...input, actionCode: action, entityType: "ENTERPRISE", entityId: current.id, before, after, reason });
      return updated;
    });
  }

  disable(input: ServiceInput & { enterpriseId: string; reason: string }) {
    return this.changeStatus(input, "NORMAL", "DISABLED");
  }

  restore(input: ServiceInput & { enterpriseId: string; reason: string }) {
    return this.changeStatus(input, "DISABLED", "NORMAL");
  }

  async merge(input: ServiceInput & { enterpriseId: string; targetEnterpriseId: string; reason: string; confirmation: "CONFIRM" }) {
    await authorizeActor({ actor: input.actor, action: "enterprise.merge", resource: {
      resourceType: "enterprise", requiredScope: "GLOBAL_OPERATIONAL",
    } });
    if (input.enterpriseId === input.targetEnterpriseId) throw new EnterpriseError("ENTERPRISE_STATE_CONFLICT", "企业不能合并到自身");
    const reason = input.reason.trim();
    return this.repository.transaction(async (tx) => {
      try {
        await this.repository.lockEnterprises(tx, [input.enterpriseId, input.targetEnterpriseId]);
      } catch (error) {
        if ((error as Error).message === "ENTERPRISE_LOCK_TARGET_NOT_FOUND") throw new EnterpriseError("ENTERPRISE_NOT_FOUND", "源企业或目标企业不存在");
        throw error;
      }
      const [source, target] = await Promise.all([
        tx.enterprise.findUnique({ where: { id: input.enterpriseId }, include: { tagRelations: true } }),
        tx.enterprise.findUnique({ where: { id: input.targetEnterpriseId } }),
      ]);
      if (!source || !target) throw new EnterpriseError("ENTERPRISE_NOT_FOUND", "源企业或目标企业不存在");
      if (source.status === "MERGED" || target.status !== "NORMAL") {
        throw new EnterpriseError("ENTERPRISE_STATE_CONFLICT", "目标企业必须正常且源企业不能已合并");
      }
      const before = snapshotEnterprise(source, source.tagRelations.map(({ tagId }) => tagId));
      const updated = await tx.enterprise.update({ where: { id: source.id }, data: {
        status: "MERGED", mergedIntoId: target.id, currentVersion: { increment: 1 },
      } });
      const after = snapshotEnterprise(updated, source.tagRelations.map(({ tagId }) => tagId));
      await tx.enterpriseVersion.create({ data: {
        enterpriseId: source.id, versionNo: updated.currentVersion, snapshotJson: after,
        changeType: "MERGE", reason, changedByPersonId: input.actor.personId,
      } });
      await writeEnterpriseTransition(tx, {
        ...input, entityType: "ENTERPRISE", entityId: source.id, fromState: source.status, toState: "MERGED",
        actionCode: "ENTERPRISE_MERGED", reason, metadata: { targetEnterpriseId: target.id },
      });
      await writeEnterpriseAudit(tx, { ...input, actionCode: "ENTERPRISE_MERGED", entityType: "ENTERPRISE", entityId: source.id, before, after, reason });
      return updated;
    });
  }

  async coordinate(input: ServiceInput & { enterpriseId: string; latitude: number; longitude: number }) {
    await authorizeActor({ actor: input.actor, action: "enterprise.map.manage", resource: {
      resourceType: "enterprise", requiredScope: "GLOBAL_OPERATIONAL",
    } });
    return this.repository.transaction(async (tx) => {
      await this.repository.lockEnterprise(tx, input.enterpriseId);
      const current = await tx.enterprise.findUnique({ where: { id: input.enterpriseId }, include: { tagRelations: true } });
      if (!current) throw new EnterpriseError("ENTERPRISE_NOT_FOUND", "企业不存在");
      if (current.status === "MERGED") throw new EnterpriseError("ENTERPRISE_STATE_CONFLICT", "已合并企业不能修改坐标");
      const areaBefore = current.responsibleAreaId;
      const before = snapshotEnterprise(current, current.tagRelations.map(({ tagId }) => tagId));
      const updated = await tx.enterprise.update({ where: { id: current.id }, data: {
        latitude: input.latitude,
        longitude: input.longitude,
        geocodeStatus: "MANUAL",
        geocodeProvider: null,
        geocodedAt: new Date(),
        coordinateUpdatedById: input.actor.personId,
        currentVersion: { increment: 1 },
      } });
      if (updated.responsibleAreaId !== areaBefore) throw new Error("COORDINATE_CHANGED_RESPONSIBLE_AREA");
      const after = snapshotEnterprise(updated, current.tagRelations.map(({ tagId }) => tagId));
      await tx.enterpriseVersion.create({ data: {
        enterpriseId: current.id, versionNo: updated.currentVersion, snapshotJson: after,
        changeType: "COORDINATE", reason: "管理员人工坐标纠正", changedByPersonId: input.actor.personId,
      } });
      await writeEnterpriseAudit(tx, { ...input, actionCode: "ENTERPRISE_COORDINATE_UPDATED", entityType: "ENTERPRISE", entityId: current.id, before, after, reason: "管理员人工坐标纠正" });
      return updated;
    });
  }

  private async authorizeContactManage(actor: PermissionActor, areaId: string) {
    return authorizeActor({ actor, action: "enterprise.contact.manage", resource: {
      resourceType: "enterprise_contact",
      requiredScope: actor.hasGlobalOperational ? "GLOBAL_OPERATIONAL" : "TOWNSHIP",
      areaId,
    } });
  }

  async createContact(input: ServiceInput & { enterpriseId: string; contact: { name: string; positionTitle?: string; phone: string; setPrimary: boolean } }) {
    return this.repository.transaction(async (tx) => {
      await this.repository.lockEnterprise(tx, input.enterpriseId);
      const enterprise = await tx.enterprise.findUnique({ where: { id: input.enterpriseId } });
      if (!enterprise) throw new EnterpriseError("ENTERPRISE_NOT_FOUND", "企业不存在");
      if (enterprise.status === "MERGED") throw new EnterpriseError("ENTERPRISE_STATE_CONFLICT", "已合并企业为只读记录");
      await this.authorizeContactManage(input.actor, enterprise.responsibleAreaId);
      const contact = await tx.enterpriseContact.create({ data: {
        enterpriseId: enterprise.id,
        name: input.contact.name,
        positionTitle: normalizeOptional(input.contact.positionTitle),
        phone: input.contact.phone,
        isPrimary: input.contact.setPrimary,
        createdByPersonId: input.actor.personId,
      } });
      if (input.contact.setPrimary) {
        await tx.enterpriseContact.updateMany({ where: { enterpriseId: enterprise.id, id: { not: contact.id } }, data: { isPrimary: false } });
        await tx.enterprise.update({ where: { id: enterprise.id }, data: { primaryContactId: contact.id } });
      }
      await writeEnterpriseAudit(tx, { ...input, actionCode: "ENTERPRISE_CONTACT_CREATED", entityType: "ENTERPRISE_CONTACT", entityId: contact.id, after: {
        enterpriseId: enterprise.id, name: contact.name, positionTitle: contact.positionTitle, phone: contact.phone, isPrimary: contact.isPrimary, status: contact.status,
      } });
      return contact;
    });
  }

  async updateContact(input: ServiceInput & { contactId: string; changes: { name?: string; positionTitle?: string | null; phone?: string } }) {
    return this.repository.transaction(async (tx) => {
      const contact = await this.repository.findContact(tx, input.contactId);
      if (!contact) throw new EnterpriseError("ENTERPRISE_CONTACT_NOT_FOUND", "企业联系人不存在");
      await this.authorizeContactManage(input.actor, contact.enterprise.responsibleAreaId);
      if (contact.enterprise.status === "MERGED" || contact.status !== "ACTIVE") {
        throw new EnterpriseError("ENTERPRISE_STATE_CONFLICT", "当前联系人不可修改");
      }
      const updated = await tx.enterpriseContact.update({ where: { id: contact.id }, data: {
        ...input.changes,
        positionTitle: normalizeOptional(input.changes.positionTitle),
      } });
      await writeEnterpriseAudit(tx, { ...input, actionCode: "ENTERPRISE_CONTACT_UPDATED", entityType: "ENTERPRISE_CONTACT", entityId: contact.id,
        before: { name: contact.name, positionTitle: contact.positionTitle, phone: contact.phone },
        after: { name: updated.name, positionTitle: updated.positionTitle, phone: updated.phone },
      });
      return updated;
    });
  }

  async setPrimaryContact(input: ServiceInput & { contactId: string }) {
    return this.repository.transaction(async (tx) => {
      const snapshot = await this.repository.findContact(tx, input.contactId);
      if (!snapshot) throw new EnterpriseError("ENTERPRISE_CONTACT_NOT_FOUND", "企业联系人不存在");
      await this.repository.lockEnterprise(tx, snapshot.enterpriseId);
      const contact = await this.repository.findContact(tx, input.contactId);
      if (!contact) throw new EnterpriseError("ENTERPRISE_CONTACT_NOT_FOUND", "企业联系人不存在");
      await this.authorizeContactManage(input.actor, contact.enterprise.responsibleAreaId);
      if (contact.enterprise.status === "MERGED" || contact.status !== "ACTIVE") {
        throw new EnterpriseError("ENTERPRISE_CONTACT_INVALID_REPLACEMENT", "只有当前企业的有效联系人可设为主要联系人");
      }
      const previousId = contact.enterprise.primaryContactId;
      await tx.enterpriseContact.updateMany({ where: { enterpriseId: contact.enterpriseId, isPrimary: true }, data: { isPrimary: false } });
      await tx.enterpriseContact.update({ where: { id: contact.id }, data: { isPrimary: true } });
      await tx.enterprise.update({ where: { id: contact.enterpriseId }, data: { primaryContactId: contact.id } });
      await writeEnterpriseAudit(tx, { ...input, actionCode: "ENTERPRISE_CONTACT_PRIMARY_CHANGED", entityType: "ENTERPRISE_CONTACT", entityId: contact.id,
        before: { primaryContactId: previousId }, after: { primaryContactId: contact.id },
      });
      return { enterpriseId: contact.enterpriseId, primaryContactId: contact.id };
    });
  }

  async disableContact(input: ServiceInput & { contactId: string; reason: string; replacementContactId?: string }) {
    return this.repository.transaction(async (tx) => {
      const snapshot = await this.repository.findContact(tx, input.contactId);
      if (!snapshot) throw new EnterpriseError("ENTERPRISE_CONTACT_NOT_FOUND", "企业联系人不存在");
      await this.repository.lockEnterprise(tx, snapshot.enterpriseId);
      const contact = await this.repository.findContact(tx, input.contactId);
      if (!contact) throw new EnterpriseError("ENTERPRISE_CONTACT_NOT_FOUND", "企业联系人不存在");
      await this.authorizeContactManage(input.actor, contact.enterprise.responsibleAreaId);
      if (contact.enterprise.status === "MERGED" || contact.status !== "ACTIVE") {
        throw new EnterpriseError("ENTERPRISE_STATE_CONFLICT", "当前联系人不可停用");
      }
      const isPrimary = contact.enterprise.primaryContactId === contact.id || contact.isPrimary;
      let replacement = null;
      if (isPrimary) {
        if (!input.replacementContactId) throw new EnterpriseError("ENTERPRISE_PRIMARY_CONTACT_REQUIRED", "停用主要联系人时必须指定新的有效主要联系人");
        replacement = await tx.enterpriseContact.findUnique({ where: { id: input.replacementContactId } });
        if (!replacement || replacement.enterpriseId !== contact.enterpriseId || replacement.status !== "ACTIVE" || replacement.id === contact.id) {
          throw new EnterpriseError("ENTERPRISE_CONTACT_INVALID_REPLACEMENT", "替换联系人必须属于同一企业且当前有效");
        }
        await tx.enterpriseContact.updateMany({ where: { enterpriseId: contact.enterpriseId, isPrimary: true }, data: { isPrimary: false } });
        await tx.enterpriseContact.update({ where: { id: replacement.id }, data: { isPrimary: true } });
        await tx.enterprise.update({ where: { id: contact.enterpriseId }, data: { primaryContactId: replacement.id } });
      }
      const disabled = await tx.enterpriseContact.update({ where: { id: contact.id }, data: {
        status: "INACTIVE", isPrimary: false, inactiveReason: input.reason.trim(),
      } });
      await writeEnterpriseAudit(tx, { ...input, actionCode: "ENTERPRISE_CONTACT_DISABLED", entityType: "ENTERPRISE_CONTACT", entityId: contact.id,
        before: { status: contact.status, isPrimary: contact.isPrimary, primaryContactId: contact.enterprise.primaryContactId },
        after: { status: disabled.status, isPrimary: false, primaryContactId: replacement?.id ?? contact.enterprise.primaryContactId },
        reason: input.reason.trim(),
      });
      return disabled;
    });
  }

  async createChangeRequest(input: ServiceInput & { request: unknown }) {
    const request = createEnterpriseChangeRequestSchema.parse(input.request);
    if (request.requestType === "CREATE") {
      await authorizeActor({ actor: input.actor, action: "enterprise.create_application", resource: {
        resourceType: "enterprise_change_request", requiredScope: "TOWNSHIP", areaId: request.proposedAreaId,
      } });
      if (request.payload.enterprise.responsibleAreaId !== request.proposedAreaId) {
        throw new EnterpriseError("ENTERPRISE_AREA_INVALID", "申请企业所属区域必须与申请区域一致");
      }
    } else {
      await authorizeActor({ actor: input.actor, action: "enterprise.correct_request" });
    }
    return this.repository.transaction(async (tx) => {
      if (request.requestType === "CREATE") await this.requireArea(tx, request.proposedAreaId);
      if (request.requestType === "CORRECTION") {
        const target = await tx.enterprise.findUnique({ where: { id: request.targetEnterpriseId } });
        if (!target) throw new EnterpriseError("ENTERPRISE_NOT_FOUND", "目标企业不存在");
        if (target.status === "MERGED") throw new EnterpriseError("ENTERPRISE_STATE_CONFLICT", "已合并企业不能提交纠错申请");
        if (target.currentVersion !== request.baseEnterpriseVersion) throw new EnterpriseError("ENTERPRISE_VERSION_CONFLICT", "企业版本已变化，请刷新后重新提交");
      }
      const created = await tx.enterpriseChangeRequest.create({ data: request.requestType === "CREATE" ? {
        requestType: "CREATE", proposedAreaId: request.proposedAreaId,
        payloadSnapshot: request.payload, submitterPersonId: input.actor.personId,
      } : {
        requestType: "CORRECTION", targetEnterpriseId: request.targetEnterpriseId,
        baseEnterpriseVersion: request.baseEnterpriseVersion,
        payloadSnapshot: request.payload, submitterPersonId: input.actor.personId,
      } });
      await writeEnterpriseTransition(tx, { ...input, entityType: "ENTERPRISE_CHANGE_REQUEST", entityId: created.id, toState: "PENDING_REVIEW", actionCode: "ENTERPRISE_CHANGE_REQUEST_CREATED" });
      await writeEnterpriseAudit(tx, { ...input, actionCode: "ENTERPRISE_CHANGE_REQUEST_CREATED", entityType: "ENTERPRISE_CHANGE_REQUEST", entityId: created.id, after: {
        requestType: created.requestType, proposedAreaId: created.proposedAreaId, targetEnterpriseId: created.targetEnterpriseId, status: created.status,
      } });
      return created;
    });
  }

  async listChangeRequests(input: ServiceInput & { query: { status?: "PENDING_REVIEW" | "APPROVED" | "RETURNED" | "CLOSED"; requestType?: "CREATE" | "CORRECTION"; page: number; pageSize: number } }) {
    await authorizeActor({ actor: input.actor, action: "enterprise.edit_formal", resource: {
      resourceType: "enterprise_change_request", requiredScope: "GLOBAL_OPERATIONAL",
    } });
    return this.repository.listChangeRequests(input.query);
  }

  async getChangeRequest(input: ServiceInput & { requestId: string }) {
    await authorizeActor({ actor: input.actor, action: "enterprise.edit_formal", resource: {
      resourceType: "enterprise_change_request", requiredScope: "GLOBAL_OPERATIONAL",
    } });
    const request = await this.repository.transaction((tx) => this.repository.findChangeRequest(tx, input.requestId));
    if (!request) throw new EnterpriseError("ENTERPRISE_CHANGE_REQUEST_NOT_FOUND", "企业申请不存在");
    return request;
  }

  async resubmitChangeRequest(input: ServiceInput & { requestId: string; body: unknown }) {
    const body = resubmitEnterpriseChangeRequestSchema.parse(input.body);
    return this.repository.transaction(async (tx) => {
      try {
        await this.repository.lockChangeRequest(tx, input.requestId);
      } catch (error) {
        if ((error as Error).message === "ENTERPRISE_CHANGE_REQUEST_LOCK_TARGET_NOT_FOUND") throw new EnterpriseError("ENTERPRISE_CHANGE_REQUEST_NOT_FOUND", "企业申请不存在");
        throw error;
      }
      const request = await tx.enterpriseChangeRequest.findUnique({ where: { id: input.requestId } });
      if (!request) throw new EnterpriseError("ENTERPRISE_CHANGE_REQUEST_NOT_FOUND", "企业申请不存在");
      if (request.status !== "RETURNED" || request.submitterPersonId !== input.actor.personId) {
        throw new EnterpriseError("ENTERPRISE_CHANGE_REQUEST_STATE_CONFLICT", "只有原提交人可以重新提交已退回申请");
      }
      let payload: Prisma.InputJsonValue;
      let baseVersion: number | null = request.baseEnterpriseVersion;
      if (request.requestType === "CREATE") {
        await authorizeActor({ actor: input.actor, action: "enterprise.create_application", resource: {
          resourceType: "enterprise_change_request", requiredScope: "TOWNSHIP", areaId: request.proposedAreaId ?? undefined,
        } });
        const parsed = createEnterpriseChangeRequestSchema.options[0].shape.payload.parse(body.payload);
        if (parsed.enterprise.responsibleAreaId !== request.proposedAreaId) throw new EnterpriseError("ENTERPRISE_AREA_INVALID", "申请企业所属区域必须与申请区域一致");
        payload = parsed;
        baseVersion = null;
      } else {
        await authorizeActor({ actor: input.actor, action: "enterprise.correct_request" });
        const parsed = createEnterpriseChangeRequestSchema.options[1].shape.payload.parse(body.payload);
        const target = await tx.enterprise.findUnique({ where: { id: request.targetEnterpriseId! } });
        if (!target) throw new EnterpriseError("ENTERPRISE_NOT_FOUND", "目标企业不存在");
        baseVersion = body.baseEnterpriseVersion ?? target.currentVersion;
        if (baseVersion !== target.currentVersion) throw new EnterpriseError("ENTERPRISE_VERSION_CONFLICT", "企业版本已变化，请刷新后重新提交");
        payload = parsed;
      }
      const updated = await tx.enterpriseChangeRequest.update({ where: { id: request.id }, data: {
        payloadSnapshot: payload,
        baseEnterpriseVersion: baseVersion,
        status: "PENDING_REVIEW",
        reviewerPersonId: null,
        reviewReason: null,
        reviewedAt: null,
        submittedAt: new Date(),
      } });
      await writeEnterpriseTransition(tx, { ...input, entityType: "ENTERPRISE_CHANGE_REQUEST", entityId: request.id, fromState: "RETURNED", toState: "PENDING_REVIEW", actionCode: "ENTERPRISE_CHANGE_REQUEST_RESUBMITTED" });
      await writeEnterpriseAudit(tx, { ...input, actionCode: "ENTERPRISE_CHANGE_REQUEST_RESUBMITTED", entityType: "ENTERPRISE_CHANGE_REQUEST", entityId: request.id,
        before: { status: request.status, baseEnterpriseVersion: request.baseEnterpriseVersion },
        after: { status: updated.status, baseEnterpriseVersion: updated.baseEnterpriseVersion },
      });
      return updated;
    });
  }

  async reviewChangeRequest(input: ServiceInput & { requestId: string; decision: "APPROVE" | "RETURN" | "CLOSE"; reason?: string }) {
    await authorizeActor({ actor: input.actor, action: "enterprise.edit_formal", resource: {
      resourceType: "enterprise_change_request", requiredScope: "GLOBAL_OPERATIONAL",
    } });
    try {
      return await this.repository.transaction(async (tx) => {
        try {
          await this.repository.lockChangeRequest(tx, input.requestId);
        } catch (error) {
          if ((error as Error).message === "ENTERPRISE_CHANGE_REQUEST_LOCK_TARGET_NOT_FOUND") throw new EnterpriseError("ENTERPRISE_CHANGE_REQUEST_NOT_FOUND", "企业申请不存在");
          throw error;
        }
        const request = await tx.enterpriseChangeRequest.findUnique({ where: { id: input.requestId } });
        if (!request) throw new EnterpriseError("ENTERPRISE_CHANGE_REQUEST_NOT_FOUND", "企业申请不存在");
        if (request.status !== "PENDING_REVIEW") throw new EnterpriseError("ENTERPRISE_CHANGE_REQUEST_STATE_CONFLICT", "企业申请已被其他管理员处理");
        const reviewedAt = new Date();
        if (input.decision !== "APPROVE") {
          const status = input.decision === "RETURN" ? "RETURNED" : "CLOSED";
          const action = input.decision === "RETURN" ? "ENTERPRISE_CHANGE_REQUEST_RETURNED" : "ENTERPRISE_CHANGE_REQUEST_CLOSED";
          const updated = await tx.enterpriseChangeRequest.update({ where: { id: request.id }, data: {
            status, reviewerPersonId: input.actor.personId, reviewReason: input.reason!.trim(), reviewedAt,
          } });
          await writeEnterpriseTransition(tx, { ...input, entityType: "ENTERPRISE_CHANGE_REQUEST", entityId: request.id, fromState: "PENDING_REVIEW", toState: status, actionCode: action, reason: input.reason });
          await writeEnterpriseAudit(tx, { ...input, actionCode: action, entityType: "ENTERPRISE_CHANGE_REQUEST", entityId: request.id, before: { status: request.status }, after: { status }, reason: input.reason });
          return updated;
        }

        let approvedEnterpriseId: string;
        if (request.requestType === "CREATE") {
          const payload = createEnterpriseChangeRequestSchema.options[0].shape.payload.parse(request.payloadSnapshot);
          if (payload.enterprise.responsibleAreaId !== request.proposedAreaId) throw new EnterpriseError("ENTERPRISE_AREA_INVALID", "申请企业所属区域与申请记录不一致");
          const enterprise = await this.createFormalInTransaction(tx, payload.enterprise, input, "CHANGE_REQUEST_APPROVED", input.reason);
          approvedEnterpriseId = enterprise.id;
        } else {
          const payload = createEnterpriseChangeRequestSchema.options[1].shape.payload.parse(request.payloadSnapshot);
          if (!request.targetEnterpriseId || request.baseEnterpriseVersion === null) throw new EnterpriseError("ENTERPRISE_CHANGE_REQUEST_STATE_CONFLICT", "纠错申请数据不完整");
          await this.applyCorrection(tx, request.targetEnterpriseId, payload.changes, input, input.reason ?? "企业纠错申请审核通过", "CHANGE_REQUEST_APPROVED", request.baseEnterpriseVersion);
          approvedEnterpriseId = request.targetEnterpriseId;
        }
        const updated = await tx.enterpriseChangeRequest.update({ where: { id: request.id }, data: {
          status: "APPROVED", reviewerPersonId: input.actor.personId, reviewReason: input.reason, reviewedAt, approvedEnterpriseId,
        } });
        await writeEnterpriseTransition(tx, { ...input, entityType: "ENTERPRISE_CHANGE_REQUEST", entityId: request.id, fromState: "PENDING_REVIEW", toState: "APPROVED", actionCode: "ENTERPRISE_CHANGE_REQUEST_APPROVED", reason: input.reason, metadata: { approvedEnterpriseId } });
        await writeEnterpriseAudit(tx, { ...input, actionCode: "ENTERPRISE_CHANGE_REQUEST_APPROVED", entityType: "ENTERPRISE_CHANGE_REQUEST", entityId: request.id, before: { status: request.status }, after: { status: "APPROVED", approvedEnterpriseId }, reason: input.reason });
        return updated;
      });
    } catch (error) {
      if (isPrismaUniqueConflict(error)) throw new EnterpriseError("ENTERPRISE_DUPLICATE_CREDIT_CODE", "统一社会信用代码已存在");
      throw error;
    }
  }
}
