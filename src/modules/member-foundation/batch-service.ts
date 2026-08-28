import type { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { authorizeActor } from "@/modules/permissions/authorization";
import { bumpPermissionVersions } from "@/modules/permissions/permission-invalidation";
import type { PermissionActor } from "@/modules/permissions/types";
import { writeFoundationAudit, writeFoundationTransition, type MutationContext } from "./audit";
import { FoundationError } from "./errors";
import { batchActivationSchema, batchCloseSchema, batchCreateSchema, groupLeaderSchema, membershipSchema, membershipUpdateSchema } from "./schemas";
import { BackupService } from "@/modules/system/backup-service";
import { findSystemCommand, requireIdempotencyKey, saveSystemCommand, stableHash } from "@/modules/system/command";

type ServiceInput = { actor: PermissionActor; context?: MutationContext };

function iso(value: Date | null | undefined) { return value?.toISOString() ?? null; }
function optional(value: string | null | undefined) { return value?.trim() ? value.trim() : null; }
function isUnique(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && error.code === "P2002"; }

export class BatchService {
  constructor(private readonly prisma = getPrismaClient(), private readonly backups = new BackupService(prisma)) {}

  async list(input: ServiceInput) {
    await authorizeActor({ actor: input.actor, action: "member.batch.manage", resource: { resourceType: "batch", requiredScope: "GLOBAL_OPERATIONAL" } });
    return this.prisma.batch.findMany({
      orderBy: [{ year: "desc" }, { startDate: "desc" }],
      include: {
        _count: { select: { memberships: true } },
        groupLeaderAssignments: {
          where: { effectiveAt: { lte: new Date() }, OR: [{ expiredAt: null }, { expiredAt: { gt: new Date() } }] },
          include: { person: { select: { id: true, name: true } } },
        },
      },
    });
  }

  async publicList(input: ServiceInput) {
    await authorizeActor({ actor: input.actor, action: "member.view", resource: { resourceType: "batch", requiredScope: "GLOBAL_PUBLISHED" } });
    return this.prisma.batch.findMany({ orderBy: [{ year: "desc" }, { startDate: "desc" }], select: { id: true, name: true, year: true, startDate: true, endDate: true, status: true, isCurrent: true } });
  }

  async create(input: ServiceInput & { batch: unknown }) {
    await authorizeActor({ actor: input.actor, action: "member.batch.manage", resource: { resourceType: "batch", requiredScope: "GLOBAL_OPERATIONAL" } });
    const value = batchCreateSchema.parse(input.batch);
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.batch.create({ data: { ...value, endDate: value.endDate ?? null } });
      await writeFoundationAudit(tx, { ...input, actionCode: "BATCH_CREATED", entityType: "BATCH", entityId: batch.id, after: { name: batch.name, year: batch.year, status: batch.status } });
      await writeFoundationTransition(tx, { ...input, entityType: "BATCH", entityId: batch.id, toState: "PLANNED", actionCode: "BATCH_CREATED" });
      return batch;
    });
  }

  async activationPreview(input: ServiceInput & { batchId: string }) {
    await authorizeActor({ actor: input.actor, action: "member.batch.manage", resource: { resourceType: "batch", requiredScope: "SYSTEM" } });
    const [target, current] = await Promise.all([
      this.prisma.batch.findUnique({ where: { id: input.batchId }, include: { _count: { select: { memberships: true } } } }),
      this.prisma.batch.findMany({ where: { isCurrent: true }, select: { id: true, name: true, status: true } }),
    ]);
    if (!target) throw new FoundationError("BATCH_NOT_FOUND", "批次不存在");
    if (target.status === "CLOSED") throw new FoundationError("BATCH_STATE_CONFLICT", "已关闭批次不能激活");
    if (current.length > 1) throw new FoundationError("BATCH_STATE_CONFLICT", "当前批次配置不唯一");
    const payload = {
      target: { id: target.id, name: target.name, membershipCount: target._count.memberships },
      current: current[0] ?? null,
      expectedCurrentBatchId: current[0]?.id ?? null,
      warning: "切换后原团长权限立即失效，团员权限缓存将刷新。",
    };
    return { ...payload, backupReadiness: await this.backups.health(), previewToken: stableHash(payload) };
  }

  async activate(input: ServiceInput & { batchId: string; command: unknown; idempotencyKey: string | null }) {
    await authorizeActor({ actor: input.actor, action: "member.batch.manage", resource: { resourceType: "batch", requiredScope: "SYSTEM" } });
    const command = batchActivationSchema.parse(input.command);
    const keyHash = requireIdempotencyKey(input.idempotencyKey);
    const payloadHash = stableHash({ batchId: input.batchId, command });
    const prior = await this.prisma.$transaction((tx) => findSystemCommand(tx, { actorPersonId: input.actor.personId, action: "BATCH_SWITCH", keyHash, payloadHash }));
    if (prior) return prior.responseJson;
    const preview = await this.activationPreview({ ...input, batchId: input.batchId });
    if (preview.previewToken !== command.previewToken || preview.expectedCurrentBatchId !== command.expectedCurrentBatchId) throw new FoundationError("BATCH_ACTIVATION_STALE", "批次影响预览已变化，请重新确认");
    const backup = await this.backups.requestPreOperation({ ...input, type: "PRE_BATCH_SWITCH", reason: command.reason, idempotencyKey: `batch-switch:${input.idempotencyKey}` });
    return this.prisma.$transaction(async (tx) => {
      const replay = await findSystemCommand(tx, { actorPersonId: input.actor.personId, action: "BATCH_SWITCH", keyHash, payloadHash });
      if (replay) return replay.responseJson;
      await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM batches ORDER BY id FOR UPDATE`;
      const target = await tx.batch.findUnique({ where: { id: input.batchId } });
      if (!target) throw new FoundationError("BATCH_NOT_FOUND", "批次不存在");
      if (target.status === "CLOSED") throw new FoundationError("BATCH_STATE_CONFLICT", "已关闭批次不能激活");
      const current = await tx.batch.findMany({ where: { isCurrent: true }, select: { id: true } });
      if (current.length > 1) throw new FoundationError("BATCH_STATE_CONFLICT", "当前批次配置不唯一");
      const currentId = current[0]?.id ?? null;
      if (currentId !== command.expectedCurrentBatchId) {
        throw new FoundationError("BATCH_ACTIVATION_STALE", "当前批次已变化，请重新确认影响范围", { expected: command.expectedCurrentBatchId, current: currentId });
      }
      if (currentId === target.id && target.status === "ACTIVE") return target;
      const now = new Date();
      const affectedPeople = await tx.batchMembership.findMany({
        where: { batchId: { in: [currentId, target.id].filter((value): value is string => value !== null) } },
        select: { personId: true },
      });
      const oldLeaders = currentId ? await tx.groupLeaderAssignment.findMany({
        where: { batchId: currentId, effectiveAt: { lte: now }, OR: [{ expiredAt: null }, { expiredAt: { gt: now } }] }, select: { personId: true },
      }) : [];
      if (currentId) {
        await tx.groupLeaderAssignment.updateMany({ where: { batchId: currentId, effectiveAt: { lte: now }, OR: [{ expiredAt: null }, { expiredAt: { gt: now } }] }, data: { expiredAt: now } });
        await tx.roleAssignment.updateMany({ where: { personId: { in: oldLeaders.map(({ personId }) => personId) }, roleCode: "GROUP_LEADER", effectiveAt: { lte: now }, OR: [{ expiredAt: null }, { expiredAt: { gt: now } }] }, data: { expiredAt: now } });
      }
      await tx.batch.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
      const updated = await tx.batch.update({ where: { id: target.id }, data: { isCurrent: true, status: "ACTIVE" } });
      const validCurrentMemberships = await tx.batchMembership.findMany({
        where: { batchId: target.id, status: "ACTIVE", startDate: { lte: now }, OR: [{ endDate: null }, { endDate: { gt: now } }] }, select: { personId: true },
      });
      for (const { personId } of validCurrentMemberships) {
        const existing = await tx.roleAssignment.findFirst({ where: { personId, roleCode: "MEMBER_CURRENT", effectiveAt: { lte: now }, OR: [{ expiredAt: null }, { expiredAt: { gt: now } }] } });
        if (!existing) await tx.roleAssignment.create({ data: { personId, roleCode: "MEMBER_CURRENT", effectiveAt: now, grantedByPersonId: input.actor.personId, reason: `激活批次：${target.name}` } });
      }
      await bumpPermissionVersions([...affectedPeople.map(({ personId }) => personId), ...oldLeaders.map(({ personId }) => personId)], tx);
      const [currentCount, activeCurrentCount] = await Promise.all([
        tx.batch.count({ where: { isCurrent: true } }),
        tx.batch.count({ where: { isCurrent: true, status: "ACTIVE" } }),
      ]);
      if (currentCount !== 1 || activeCurrentCount !== 1) throw new FoundationError("BATCH_STATE_CONFLICT", "批次切换未能保持唯一有效当前批次");
      await writeFoundationTransition(tx, { ...input, entityType: "BATCH", entityId: target.id, fromState: target.status, toState: "ACTIVE_CURRENT", actionCode: "BATCH_ACTIVATED", reason: command.reason, metadata: { previousCurrentBatchId: currentId, preBackupRecordId: backup.id } });
      await writeFoundationAudit(tx, { ...input, actionCode: "BATCH_ACTIVATED", entityType: "BATCH", entityId: target.id, reason: command.reason, before: { currentBatchId: currentId }, after: { currentBatchId: target.id, preBackupRecordId: backup.id } });
      await saveSystemCommand(tx, { actorPersonId: input.actor.personId, action: "BATCH_SWITCH", keyHash, payloadHash, aggregateType: "BATCH", aggregateId: target.id, response: { id: updated.id, currentBatchId: updated.id, preBackupRecordId: backup.id } });
      return updated;
    });
  }

  async close(input: ServiceInput & { batchId: string; command: unknown }) {
    await authorizeActor({ actor: input.actor, action: "member.batch.manage", resource: { resourceType: "batch", requiredScope: "GLOBAL_OPERATIONAL" } });
    const command = batchCloseSchema.parse(input.command);
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM batches WHERE id = ${input.batchId} FOR UPDATE`;
      if (!rows.length) throw new FoundationError("BATCH_NOT_FOUND", "批次不存在");
      const batch = await tx.batch.findUniqueOrThrow({ where: { id: input.batchId } });
      if (batch.isCurrent) throw new FoundationError("BATCH_CURRENT_CLOSE_FORBIDDEN", "当前批次不能直接关闭，请先切换当前批次");
      if (batch.status === "CLOSED") return batch;
      const updated = await tx.batch.update({ where: { id: batch.id }, data: { status: "CLOSED" } });
      await writeFoundationTransition(tx, { ...input, entityType: "BATCH", entityId: batch.id, fromState: batch.status, toState: "CLOSED", actionCode: "BATCH_CLOSED", reason: command.reason });
      await writeFoundationAudit(tx, { ...input, actionCode: "BATCH_CLOSED", entityType: "BATCH", entityId: batch.id, reason: command.reason, before: { status: batch.status }, after: { status: "CLOSED" } });
      return updated;
    });
  }

  async setGroupLeader(input: ServiceInput & { batchId: string; command: unknown }) {
    await authorizeActor({ actor: input.actor, action: "group_leader.assign", resource: { resourceType: "batch", requiredScope: "SYSTEM" } });
    const command = groupLeaderSchema.parse(input.command);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM batches WHERE id = ${input.batchId} FOR UPDATE`;
      const batch = await tx.batch.findUnique({ where: { id: input.batchId } });
      if (!batch) throw new FoundationError("BATCH_NOT_FOUND", "批次不存在");
      if (!batch.isCurrent || batch.status !== "ACTIVE") throw new FoundationError("BATCH_STATE_CONFLICT", "只能维护当前有效批次的团长");
      const now = new Date();
      const activeAssignments = await tx.groupLeaderAssignment.findMany({ where: { batchId: batch.id, effectiveAt: { lte: now }, OR: [{ expiredAt: null }, { expiredAt: { gt: now } }] } });
      const previousIds = activeAssignments.map(({ personId }) => personId);
      await tx.groupLeaderAssignment.updateMany({ where: { id: { in: activeAssignments.map(({ id }) => id) } }, data: { expiredAt: now } });
      await tx.roleAssignment.updateMany({ where: { personId: { in: previousIds }, roleCode: "GROUP_LEADER", effectiveAt: { lte: now }, OR: [{ expiredAt: null }, { expiredAt: { gt: now } }] }, data: { expiredAt: now } });
      let assignedPersonId: string | null = null;
      if (command.action === "ASSIGN") {
        const candidate = await tx.person.findUnique({ where: { id: command.personId }, include: { account: true } });
        const membership = await tx.batchMembership.findUnique({ where: { personId_batchId: { personId: command.personId, batchId: batch.id } } });
        const memberRole = await tx.roleAssignment.findFirst({ where: { personId: command.personId, roleCode: "MEMBER_CURRENT", effectiveAt: { lte: now }, OR: [{ expiredAt: null }, { expiredAt: { gt: now } }] } });
        if (!candidate?.account || candidate.account.status === "DISABLED" || !membership || membership.status !== "ACTIVE" || membership.startDate > now || membership.endDate && membership.endDate <= now || !memberRole) {
          throw new FoundationError("GROUP_LEADER_INVALID", "团长必须是当前批次有效团员且具有可用登录账号");
        }
        assignedPersonId = command.personId;
        await tx.groupLeaderAssignment.create({ data: { personId: command.personId, batchId: batch.id, effectiveAt: now, grantedByPersonId: input.actor.personId, reason: command.reason } });
        const activeLeaderRole = await tx.roleAssignment.findFirst({ where: { personId: command.personId, roleCode: "GROUP_LEADER", effectiveAt: { lte: now }, OR: [{ expiredAt: null }, { expiredAt: { gt: now } }] } });
        if (!activeLeaderRole) await tx.roleAssignment.create({ data: { personId: command.personId, roleCode: "GROUP_LEADER", effectiveAt: now, grantedByPersonId: input.actor.personId, reason: command.reason } });
      }
      await bumpPermissionVersions([...previousIds, ...(assignedPersonId ? [assignedPersonId] : [])], tx);
      await writeFoundationTransition(tx, { ...input, entityType: "GROUP_LEADER_ASSIGNMENT", entityId: batch.id, fromState: previousIds[0] ?? "NONE", toState: assignedPersonId ?? "NONE", actionCode: command.action === "ASSIGN" ? "GROUP_LEADER_ASSIGNED" : "GROUP_LEADER_REVOKED", reason: command.reason });
      await writeFoundationAudit(tx, { ...input, actionCode: command.action === "ASSIGN" ? "GROUP_LEADER_ASSIGNED" : "GROUP_LEADER_REVOKED", entityType: "BATCH", entityId: batch.id, reason: command.reason, before: { personIds: previousIds }, after: { personId: assignedPersonId } });
      return { batchId: batch.id, personId: assignedPersonId };
    });
  }

  async addMembership(input: ServiceInput & { personId: string; membership: unknown }) {
    await authorizeActor({ actor: input.actor, action: "member.manage", resource: { resourceType: "member", requiredScope: "GLOBAL_OPERATIONAL" } });
    const value = membershipSchema.parse(input.membership);
    if (value.dispatchOrganizationId !== undefined || value.postOrganizationId !== undefined) await authorizeActor({ actor: input.actor, action: "member.dispatch_org.manage", resource: { resourceType: "member", requiredScope: "GLOBAL_OPERATIONAL" } });
    try {
      return await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM persons WHERE id = ${input.personId} FOR UPDATE`;
        if (!locked.length) throw new FoundationError("MEMBER_NOT_FOUND", "人员不存在");
        if (await tx.batchMembership.count({ where: { personId: input.personId } }) >= 3) throw new FoundationError("MEMBERSHIP_LIMIT_EXCEEDED", "每人最多只能关联三个批次");
        const batch = await tx.batch.findUnique({ where: { id: value.batchId } });
        if (!batch) throw new FoundationError("BATCH_NOT_FOUND", "批次不存在");
        if (batch.status === "CLOSED" && !input.actor.hasSystem) throw new FoundationError("BATCH_STATE_CONFLICT", "已关闭批次仅超级管理员可维护");
        await this.validateOrganizations(tx, value.dispatchOrganizationId, value.postOrganizationId);
        const membership = await tx.batchMembership.create({ data: {
          personId: input.personId, batchId: value.batchId,
          dispatchOrganizationId: value.dispatchOrganizationId ?? null, postOrganizationId: value.postOrganizationId ?? null,
          positionTitle: optional(value.positionTitle), startDate: value.startDate, endDate: value.endDate ?? null, status: value.status,
        } });
        await bumpPermissionVersions([input.personId], tx);
        await writeFoundationAudit(tx, { ...input, actionCode: "BATCH_MEMBERSHIP_CREATED", entityType: "BATCH_MEMBERSHIP", entityId: membership.id, after: { personId: input.personId, batchId: value.batchId, status: value.status } });
        return membership;
      });
    } catch (error) {
      if (isUnique(error)) throw new FoundationError("MEMBERSHIP_DUPLICATE", "该人员已经属于此批次");
      throw error;
    }
  }

  async updateMembership(input: ServiceInput & { membershipId: string; changes: unknown }) {
    await authorizeActor({ actor: input.actor, action: "member.manage", resource: { resourceType: "member", requiredScope: "GLOBAL_OPERATIONAL" } });
    const changes = membershipUpdateSchema.parse(input.changes);
    if (changes.dispatchOrganizationId !== undefined || changes.postOrganizationId !== undefined) await authorizeActor({ actor: input.actor, action: "member.dispatch_org.manage", resource: { resourceType: "member", requiredScope: "GLOBAL_OPERATIONAL" } });
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM batch_memberships WHERE id = ${input.membershipId} FOR UPDATE`;
      if (!rows.length) throw new FoundationError("MEMBER_NOT_FOUND", "批次成员关系不存在");
      const existing = await tx.batchMembership.findUniqueOrThrow({ where: { id: input.membershipId }, include: { batch: true } });
      if (existing.batch.status === "CLOSED" && !input.actor.hasSystem) throw new FoundationError("BATCH_STATE_CONFLICT", "已关闭批次仅超级管理员可维护");
      const candidateStartDate = changes.startDate ?? existing.startDate;
      const candidateEndDate = changes.endDate === undefined ? existing.endDate : changes.endDate;
      if (candidateEndDate !== null && candidateEndDate < candidateStartDate) {
        throw new FoundationError("MEMBERSHIP_DATE_INVALID", "批次成员关系结束日期不能早于开始日期");
      }
      await this.validateOrganizations(tx, changes.dispatchOrganizationId, changes.postOrganizationId);
      const updated = await tx.batchMembership.update({ where: { id: existing.id }, data: {
        ...changes,
        dispatchOrganizationId: changes.dispatchOrganizationId,
        postOrganizationId: changes.postOrganizationId,
        positionTitle: changes.positionTitle === undefined ? undefined : optional(changes.positionTitle),
        endDate: changes.endDate,
      } });
      await bumpPermissionVersions([existing.personId], tx);
      await writeFoundationAudit(tx, { ...input, actionCode: "BATCH_MEMBERSHIP_UPDATED", entityType: "BATCH_MEMBERSHIP", entityId: existing.id, before: { status: existing.status, endDate: iso(existing.endDate) }, after: { status: updated.status, endDate: iso(updated.endDate) } });
      return updated;
    });
  }

  private async validateOrganizations(tx: Prisma.TransactionClient, dispatchId?: string | null, postId?: string | null) {
    if (dispatchId) {
      const organization = await tx.organization.findFirst({ where: { id: dispatchId, type: "DISPATCH_UNIT", status: "ACTIVE" } });
      if (!organization) throw new FoundationError("MEMBERSHIP_ORGANIZATION_INVALID", "派出单位不存在、已停用或类型不正确");
    }
    if (postId) {
      const organization = await tx.organization.findFirst({ where: { id: postId, type: "POST_UNIT", status: "ACTIVE" } });
      if (!organization) throw new FoundationError("MEMBERSHIP_ORGANIZATION_INVALID", "挂职单位不存在、已停用或类型不正确");
    }
  }
}
