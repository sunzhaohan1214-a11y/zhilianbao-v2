import { createHash } from "node:crypto";
import type { HelpRequest, Prisma } from "@/generated/prisma/client";
import { authorizeActor } from "@/modules/permissions/authorization";
import type { PermissionActor } from "@/modules/permissions/types";
import { OutboxRepository } from "@/modules/outbox/outbox-repository";
import { activeOrganizationStaff } from "@/modules/notification/recipient-resolver";
import { writeHelpAudit, writeHelpTransition, type HelpMutationContext } from "./audit";
import { HelpError, isHelpCommandIdempotencyUniqueConflict } from "./errors";
import { HelpRepository, type HelpTransaction } from "./repository/help-repository";
import {
  addHelpProgressSchema,
  assignHelpPersonSchema,
  claimHelpRequestSchema,
  completeHelpRequestSchema,
  createHelpRequestSchema,
  helpReasonSchema,
  reassignHelpRequestSchema,
  transferHelpOrganizationSchema,
} from "./schemas";

type ServiceInput = { actor: PermissionActor; context?: HelpMutationContext };

function stateSnapshot(help: Pick<
  HelpRequest,
  | "status"
  | "currentOwnerPersonId"
  | "transferredOrganizationId"
  | "expectedCompleteAt"
  | "completedAt"
  | "withdrawnAt"
>) : Prisma.InputJsonObject {
  return {
    status: help.status,
    currentOwnerPersonId: help.currentOwnerPersonId,
    transferredOrganizationId: help.transferredOrganizationId,
    expectedCompleteAt: help.expectedCompleteAt?.toISOString() ?? null,
    completedAt: help.completedAt?.toISOString() ?? null,
    withdrawnAt: help.withdrawnAt?.toISOString() ?? null,
  };
}

export function requireFutureExpectedDate(value: Date, now = new Date()) {
  if (!Number.isFinite(value.getTime()) || value <= now) {
    throw new HelpError("HELP_EXPECTED_DATE_INVALID", "预计完成时间必须是合理的未来时间");
  }
}

export function isHelpOverdue(help: Pick<HelpRequest, "status" | "expectedCompleteAt">, now = new Date()) {
  return help.status === "IN_PROGRESS" && help.expectedCompleteAt !== null && help.expectedCompleteAt < now;
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export class HelpService {
  constructor(private readonly repository = new HelpRepository()) {}
  private readonly outbox = new OutboxRepository();

  private async requireLocked(tx: HelpTransaction, helpRequestId: string) {
    try {
      await this.repository.lockHelp(tx, helpRequestId);
    } catch (error) {
      if ((error as Error).message === "HELP_LOCK_TARGET_NOT_FOUND") {
        throw new HelpError("HELP_NOT_FOUND", "办事求助不存在");
      }
      throw error;
    }
    const help = await this.repository.findById(tx, helpRequestId);
    if (!help) throw new HelpError("HELP_NOT_FOUND", "办事求助不存在");
    return help;
  }

  private async attachFiles(
    tx: HelpTransaction,
    entityType: "HELP_REQUEST" | "HELP_PROGRESS",
    entityId: string,
    attachmentIds: readonly string[],
    actorPersonId: string,
  ) {
    const unique = [...new Set(attachmentIds)].sort();
    if (unique.length !== attachmentIds.length) {
      throw new HelpError("HELP_ATTACHMENT_INVALID", "附件不能重复");
    }
    for (const attachmentId of unique) {
      const rows = await tx.$queryRaw<Array<{
        id: string;
        uploadedByPersonId: string | null;
        isTemporary: boolean | number;
        uploadStatus: string;
        scanStatus: string;
        linkId: string | null;
      }>>`
        SELECT a.id, a.uploaded_by_person_id AS uploadedByPersonId,
          a.is_temporary AS isTemporary, a.upload_status AS uploadStatus,
          a.scan_status AS scanStatus, l.id AS linkId
        FROM attachments a
        LEFT JOIN attachment_links l ON l.attachment_id = a.id
        WHERE a.id = ${attachmentId}
        FOR UPDATE
      `;
      const attachment = rows[0];
      if (
        !attachment
        || rows.length !== 1
        || attachment.uploadedByPersonId !== actorPersonId
        || !(attachment.isTemporary === true || attachment.isTemporary === 1)
        || attachment.linkId !== null
        || attachment.uploadStatus !== "UPLOADED"
        || !["PENDING", "SCANNING", "PASSED"].includes(attachment.scanStatus)
      ) {
        throw new HelpError(
          "HELP_ATTACHMENT_INVALID",
          "仅可使用本人已上传且等待扫描或已通过扫描的临时附件",
        );
      }
    }
    if (unique.length === 0) return;
    await tx.attachmentLink.createMany({
      data: unique.map((attachmentId) => ({
        attachmentId,
        entityType,
        entityId,
        relationType: "ATTACHMENT",
        createdByPersonId: actorPersonId,
      })),
    });
    await tx.attachment.updateMany({
      where: { id: { in: unique } },
      data: { isTemporary: false, permissionLevel: "SENSITIVE_PARENT" },
    });
  }

  private async expireActiveAssignment(tx: HelpTransaction, helpRequestId: string, at: Date) {
    await tx.helpAssignmentHistory.updateMany({
      where: { helpRequestId, activeKey: 1 },
      data: { expiredAt: at, activeKey: null },
    });
  }

  private async decorateDetail(
    tx: HelpTransaction,
    help: NonNullable<Awaited<ReturnType<HelpRepository["findById"]>>>,
    now = new Date(),
  ) {
    const progressIds = help.progresses.map(({ id }) => id);
    const links = await tx.attachmentLink.findMany({
      where: {
        OR: [
          { entityType: "HELP_REQUEST", entityId: help.id },
          ...(progressIds.length
            ? [{ entityType: "HELP_PROGRESS", entityId: { in: progressIds } }]
            : []),
        ],
      },
      include: {
        attachment: {
          select: { id: true, originalFilename: true, scanStatus: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });
    return {
      ...help,
      overdue: isHelpOverdue(help, now),
      attachments: links
        .filter((link) => link.entityType === "HELP_REQUEST")
        .map((link) => ({ ...link.attachment, relationType: link.relationType })),
      progresses: help.progresses.map((progress) => ({
        ...progress,
        attachments: links
          .filter((link) => link.entityType === "HELP_PROGRESS" && link.entityId === progress.id)
          .map((link) => ({ ...link.attachment, relationType: link.relationType })),
      })),
    };
  }

  async create(input: ServiceInput & { body: unknown }) {
    await authorizeActor({ actor: input.actor, action: "help.create" });
    if (!input.actor.currentBatchMember) {
      throw new HelpError("HELP_FORBIDDEN", "只有当前活动批次在任团员可以新建办事求助");
    }
    const body = createHelpRequestSchema.parse(input.body);
    return this.repository.transaction(async (tx) => {
      const businessNo = await this.repository.nextBusinessNo(tx);
      const help = await tx.helpRequest.create({
        data: {
          businessNo,
          submitterPersonId: input.actor.personId,
          category: body.category,
          title: body.title,
          description: body.description,
          urgency: body.urgency,
        },
      });
      await this.attachFiles(tx, "HELP_REQUEST", help.id, body.attachmentIds, input.actor.personId);
      await writeHelpTransition(tx, {
        ...input,
        entityId: help.id,
        actionCode: "HELP_CREATED",
        toState: "PENDING",
        metadata: { businessNo, category: body.category, urgency: body.urgency },
      });
      await writeHelpAudit(tx, {
        ...input,
        entityId: help.id,
        actionCode: "HELP_CREATED",
        after: {
          businessNo,
          status: "PENDING",
          category: body.category,
          urgency: body.urgency,
          attachmentCount: body.attachmentIds.length,
        },
      });
      const detail = await this.repository.findById(tx, help.id);
      if (!detail) throw new HelpError("HELP_NOT_FOUND", "办事求助不存在");
      return this.decorateDetail(tx, detail);
    });
  }

  async list(input: ServiceInput & { query: Parameters<HelpRepository["list"]>[0] extends infer T ? Omit<T, "actor"> : never }) {
    await authorizeActor({ actor: input.actor, action: "help.view" });
    return this.repository.list({ actor: input.actor, ...input.query });
  }

  async detail(input: ServiceInput & { helpRequestId: string }) {
    await authorizeActor({ actor: input.actor, action: "help.view" });
    return this.repository.transaction(async (tx) => {
      const help = await this.repository.findVisible(tx, input.helpRequestId, input.actor);
      if (!help) throw new HelpError("HELP_NOT_FOUND", "办事求助不存在或当前账号无权查看");
      return this.decorateDetail(tx, help);
    });
  }

  async adminOptions(input: ServiceInput) {
    await authorizeActor({
      actor: input.actor,
      action: "help.assign",
      resource: { resourceType: "help_request", requiredScope: "GLOBAL_OPERATIONAL" },
    });
    return this.repository.adminOptions();
  }

  async assignPerson(input: ServiceInput & { helpRequestId: string; body: unknown }) {
    await authorizeActor({
      actor: input.actor,
      action: "help.assign",
      resource: { resourceType: "help_request", requiredScope: "GLOBAL_OPERATIONAL" },
    });
    const body = assignHelpPersonSchema.parse(input.body);
    requireFutureExpectedDate(body.expectedCompleteAt);
    return this.repository.transaction(async (tx) => {
      const help = await this.requireLocked(tx, input.helpRequestId);
      if (help.status !== "PENDING" || help.currentOwnerPersonId) {
        throw new HelpError("HELP_STATE_CONFLICT", "只有待受理且尚无主办人的求助可以直接分派");
      }
      const assignee = await this.repository.findAssignablePerson(tx, body.personId);
      if (!assignee) throw new HelpError("HELP_PERSON_INVALID", "处理人必须是有效且账号未停用的内部人员");
      const now = new Date();
      await this.expireActiveAssignment(tx, help.id, now);
      await tx.helpAssignmentHistory.create({
        data: {
          helpRequestId: help.id,
          personId: assignee.id,
          assignmentType: "DIRECT_PERSON",
          effectiveAt: now,
          reason: body.reason,
          changedByPersonId: input.actor.personId,
        },
      });
      const updated = await tx.helpRequest.update({
        where: { id: help.id },
        data: {
          status: "IN_PROGRESS",
          currentOwnerPersonId: assignee.id,
          transferredOrganizationId: null,
          expectedCompleteAt: body.expectedCompleteAt,
        },
      });
      await writeHelpTransition(tx, {
        ...input,
        entityId: help.id,
        actionCode: "HELP_ASSIGNED_PERSON",
        fromState: "PENDING",
        toState: "IN_PROGRESS",
        reason: body.reason,
        metadata: { personId: assignee.id, expectedCompleteAt: body.expectedCompleteAt.toISOString() },
      });
      await writeHelpAudit(tx, {
        ...input,
        entityId: help.id,
        actionCode: "HELP_ASSIGNED_PERSON",
        before: stateSnapshot(help),
        after: stateSnapshot(updated),
        reason: body.reason,
      });
      await this.outbox.append({
        eventType: "HELP_ASSIGNED_PERSON",
        aggregateType: "HELP_REQUEST",
        aggregateId: help.id,
        payload: { aggregateId: help.id, recipientIds: [assignee.id], todoRecipientIds: [assignee.id], eventKey: now.toISOString() },
        dedupeKey: `help:assigned:${help.id}:${now.toISOString()}`,
      }, tx);
      const detail = await this.repository.findById(tx, help.id);
      if (!detail) throw new HelpError("HELP_NOT_FOUND", "办事求助不存在");
      return this.decorateDetail(tx, detail);
    });
  }

  async transferOrganization(input: ServiceInput & { helpRequestId: string; body: unknown }) {
    await authorizeActor({
      actor: input.actor,
      action: "help.transfer_to_org",
      resource: { resourceType: "help_request", requiredScope: "GLOBAL_OPERATIONAL" },
    });
    const body = transferHelpOrganizationSchema.parse(input.body);
    if (body.expectedCompleteAt) requireFutureExpectedDate(body.expectedCompleteAt);
    return this.repository.transaction(async (tx) => {
      const help = await this.requireLocked(tx, input.helpRequestId);
      if (help.status !== "PENDING" || help.currentOwnerPersonId) {
        throw new HelpError("HELP_STATE_CONFLICT", "只有待受理且尚无主办人的求助可以转交组织");
      }
      const organization = await this.repository.findTransferOrganization(tx, body.organizationId);
      if (!organization) {
        throw new HelpError("HELP_ORGANIZATION_INVALID", "目标必须是有效镇区或部门组织");
      }
      const now = new Date();
      await this.expireActiveAssignment(tx, help.id, now);
      await tx.helpAssignmentHistory.create({
        data: {
          helpRequestId: help.id,
          organizationId: organization.id,
          assignmentType: "ORGANIZATION_TRANSFER",
          effectiveAt: now,
          reason: body.reason,
          changedByPersonId: input.actor.personId,
        },
      });
      const updated = await tx.helpRequest.update({
        where: { id: help.id },
        data: {
          status: "PENDING",
          currentOwnerPersonId: null,
          transferredOrganizationId: organization.id,
          ...(body.expectedCompleteAt ? { expectedCompleteAt: body.expectedCompleteAt } : {}),
        },
      });
      await writeHelpTransition(tx, {
        ...input,
        entityId: help.id,
        actionCode: "HELP_TRANSFERRED_TO_ORG",
        fromState: "PENDING",
        toState: "PENDING",
        reason: body.reason,
        metadata: {
          organizationId: organization.id,
          expectedCompleteAt: body.expectedCompleteAt?.toISOString() ?? null,
        },
      });
      await writeHelpAudit(tx, {
        ...input,
        entityId: help.id,
        actionCode: "HELP_TRANSFERRED_TO_ORG",
        before: stateSnapshot(help),
        after: stateSnapshot(updated),
        reason: body.reason,
      });
      const recipients = await activeOrganizationStaff(tx, organization.id, now);
      await this.outbox.append({
        eventType: "HELP_TRANSFERRED_ORG",
        aggregateType: "HELP_REQUEST",
        aggregateId: help.id,
        payload: { aggregateId: help.id, recipientIds: recipients, todoRecipientIds: recipients, eventKey: now.toISOString() },
        dedupeKey: `help:transferred-org:${help.id}:${now.toISOString()}`,
      }, tx);
      const detail = await this.repository.findById(tx, help.id);
      if (!detail) throw new HelpError("HELP_NOT_FOUND", "办事求助不存在");
      return this.decorateDetail(tx, detail);
    });
  }

  async claim(input: ServiceInput & {
    helpRequestId: string;
    body: unknown;
    idempotencyKey: string;
  }) {
    await authorizeActor({ actor: input.actor, action: "help.claim" });
    const body = claimHelpRequestSchema.parse(input.body);
    const keyHash = hash(input.idempotencyKey);
    const payloadHash = hash(JSON.stringify({
      helpRequestId: input.helpRequestId,
      expectedCompleteAt: body.expectedCompleteAt?.toISOString() ?? null,
    }));
    try {
      return await this.repository.transaction(async (tx) => {
        const help = await this.requireLocked(tx, input.helpRequestId);
        const existing = await tx.$queryRaw<Array<{
          helpRequestId: string;
          payloadHash: string;
        }>>`
          SELECT help_request_id AS helpRequestId, payload_hash AS payloadHash
          FROM help_command_idempotencies
          WHERE actor_person_id = ${input.actor.personId}
            AND action_code = 'HELP_CLAIMED'
            AND idempotency_key_hash = ${keyHash}
          FOR UPDATE
        `;
        if (existing[0]) {
          if (existing[0].helpRequestId !== input.helpRequestId || existing[0].payloadHash !== payloadHash) {
            throw new HelpError("HELP_IDEMPOTENCY_CONFLICT", "同一幂等键不能用于不同的认领请求");
          }
          const previous = await this.repository.findById(tx, existing[0].helpRequestId);
          if (!previous) throw new HelpError("HELP_NOT_FOUND", "办事求助不存在");
          return this.decorateDetail(tx, previous);
        }
        if (help.status !== "PENDING" || help.currentOwnerPersonId) {
          throw new HelpError("HELP_ALREADY_CLAIMED", "该求助已被接手或状态已经变化");
        }
        if (!help.transferredOrganizationId) {
          throw new HelpError("HELP_STATE_CONFLICT", "该求助尚未转交到可接手组织");
        }
        if (!await this.repository.isCurrentOrganizationMember(
          tx,
          input.actor.personId,
          help.transferredOrganizationId,
        )) {
          throw new HelpError("HELP_ORGANIZATION_MEMBERSHIP_REQUIRED", "当前账号不是被转交组织的有效在岗人员");
        }
        const expectedCompleteAt = body.expectedCompleteAt ?? help.expectedCompleteAt;
        if (!expectedCompleteAt) {
          throw new HelpError("HELP_EXPECTED_DATE_INVALID", "接手时必须填写预计完成时间");
        }
        requireFutureExpectedDate(expectedCompleteAt);
        const now = new Date();
        await this.expireActiveAssignment(tx, help.id, now);
        await tx.helpAssignmentHistory.create({
          data: {
            helpRequestId: help.id,
            personId: input.actor.personId,
            assignmentType: "CLAIM",
            effectiveAt: now,
            changedByPersonId: input.actor.personId,
          },
        });
        const updated = await tx.helpRequest.update({
          where: { id: help.id },
          data: {
            status: "IN_PROGRESS",
            currentOwnerPersonId: input.actor.personId,
            expectedCompleteAt,
          },
        });
        await writeHelpTransition(tx, {
          ...input,
          entityId: help.id,
          actionCode: "HELP_CLAIMED",
          fromState: "PENDING",
          toState: "IN_PROGRESS",
          metadata: {
            personId: input.actor.personId,
            organizationId: help.transferredOrganizationId,
            expectedCompleteAt: expectedCompleteAt.toISOString(),
          },
        });
        await writeHelpAudit(tx, {
          ...input,
          entityId: help.id,
          actionCode: "HELP_CLAIMED",
          before: stateSnapshot(help),
          after: stateSnapshot(updated),
        });
        await this.outbox.append({
          eventType: "HELP_CLAIMED",
          aggregateType: "HELP_REQUEST",
          aggregateId: help.id,
          payload: { aggregateId: help.id, recipientIds: [help.submitterPersonId], todoRecipientIds: [input.actor.personId], eventKey: now.toISOString() },
          dedupeKey: `help:claimed:${help.id}`,
        }, tx);
        await tx.helpCommandIdempotency.create({
          data: {
            helpRequestId: help.id,
            actorPersonId: input.actor.personId,
            actionCode: "HELP_CLAIMED",
            idempotencyKeyHash: keyHash,
            payloadHash,
          },
        });
        const detail = await this.repository.findById(tx, help.id);
        if (!detail) throw new HelpError("HELP_NOT_FOUND", "办事求助不存在");
        return this.decorateDetail(tx, detail);
      });
    } catch (error) {
      if (!isHelpCommandIdempotencyUniqueConflict(error)) throw error;
      const replay = await this.repository.findClaimIdempotency({
        actorPersonId: input.actor.personId,
        actionCode: "HELP_CLAIMED",
        idempotencyKeyHash: keyHash,
      });
      if (!replay) throw error;
      if (replay.helpRequestId !== input.helpRequestId || replay.payloadHash !== payloadHash) {
        throw new HelpError("HELP_IDEMPOTENCY_CONFLICT", "同一幂等键不能用于不同的认领请求");
      }
      return this.repository.transaction(async (tx) => {
        const previous = await this.repository.findById(tx, replay.helpRequestId);
        if (!previous) throw new HelpError("HELP_NOT_FOUND", "办事求助不存在");
        return this.decorateDetail(tx, previous);
      });
    }
  }

  async addProgress(input: ServiceInput & { helpRequestId: string; body: unknown }) {
    await authorizeActor({ actor: input.actor, action: "help.update" });
    const body = addHelpProgressSchema.parse(input.body);
    if (body.expectedCompleteAt) requireFutureExpectedDate(body.expectedCompleteAt);
    return this.repository.transaction(async (tx) => {
      const help = await this.requireLocked(tx, input.helpRequestId);
      if (help.status !== "IN_PROGRESS") {
        throw new HelpError("HELP_STATE_CONFLICT", "只有处理中的求助可以追加进展");
      }
      if (help.currentOwnerPersonId !== input.actor.personId) {
        throw new HelpError("HELP_FORBIDDEN", "只有当前主办人可以追加进展");
      }
      const progress = await tx.helpProgress.create({
        data: {
          helpRequestId: help.id,
          content: body.content,
          nextStep: body.nextStep,
          createdByPersonId: input.actor.personId,
        },
      });
      await this.attachFiles(tx, "HELP_PROGRESS", progress.id, body.attachmentIds, input.actor.personId);
      if (body.expectedCompleteAt && body.expectedCompleteAt.getTime() !== help.expectedCompleteAt?.getTime()) {
        await tx.helpRequest.update({
          where: { id: help.id },
          data: { expectedCompleteAt: body.expectedCompleteAt },
        });
        await writeHelpAudit(tx, {
          ...input,
          entityId: help.id,
          actionCode: "HELP_EXPECTED_DATE_CHANGED",
          before: { expectedCompleteAt: help.expectedCompleteAt?.toISOString() ?? null },
          after: { expectedCompleteAt: body.expectedCompleteAt.toISOString() },
        });
      }
      await writeHelpAudit(tx, {
        ...input,
        entityId: help.id,
        actionCode: "HELP_PROGRESS_ADDED",
        after: {
          progressId: progress.id,
          attachmentCount: body.attachmentIds.length,
          expectedDateChanged: Boolean(body.expectedCompleteAt),
        },
      });
      const detail = await this.repository.findById(tx, help.id);
      if (!detail) throw new HelpError("HELP_NOT_FOUND", "办事求助不存在");
      return this.decorateDetail(tx, detail);
    });
  }

  async complete(input: ServiceInput & { helpRequestId: string; body: unknown }) {
    await authorizeActor({ actor: input.actor, action: "help.complete" });
    const body = completeHelpRequestSchema.parse(input.body);
    return this.repository.transaction(async (tx) => {
      const help = await this.requireLocked(tx, input.helpRequestId);
      if (help.status !== "IN_PROGRESS") {
        throw new HelpError("HELP_STATE_CONFLICT", "只有处理中的求助可以办结");
      }
      if (help.currentOwnerPersonId !== input.actor.personId) {
        throw new HelpError("HELP_FORBIDDEN", "只有当前主办人可以办结");
      }
      const completedAt = new Date();
      const updated = await tx.helpRequest.update({
        where: { id: help.id },
        data: {
          status: "COMPLETED",
          completedAt,
          completionSummary: body.completionSummary,
        },
      });
      await writeHelpTransition(tx, {
        ...input,
        entityId: help.id,
        actionCode: "HELP_COMPLETED",
        fromState: "IN_PROGRESS",
        toState: "COMPLETED",
      });
      await writeHelpAudit(tx, {
        ...input,
        entityId: help.id,
        actionCode: "HELP_COMPLETED",
        before: stateSnapshot(help),
        after: { ...stateSnapshot(updated), completionSummaryLength: body.completionSummary.length },
      });
      await this.outbox.append({
        eventType: "HELP_COMPLETED",
        aggregateType: "HELP_REQUEST",
        aggregateId: help.id,
        payload: { aggregateId: help.id, recipientIds: [help.submitterPersonId], todoRecipientIds: [], eventKey: completedAt.toISOString() },
        dedupeKey: `help:completed:${help.id}:${completedAt.toISOString()}`,
      }, tx);
      const detail = await this.repository.findById(tx, help.id);
      if (!detail) throw new HelpError("HELP_NOT_FOUND", "办事求助不存在");
      return this.decorateDetail(tx, detail);
    });
  }

  async withdraw(input: ServiceInput & { helpRequestId: string; body: unknown }) {
    await authorizeActor({ actor: input.actor, action: "help.withdraw" });
    const body = helpReasonSchema.parse(input.body);
    return this.repository.transaction(async (tx) => {
      const help = await this.requireLocked(tx, input.helpRequestId);
      if (help.submitterPersonId !== input.actor.personId) {
        throw new HelpError("HELP_FORBIDDEN", "只有提交人可以撤回求助");
      }
      if (help.status !== "PENDING") {
        throw new HelpError("HELP_STATE_CONFLICT", "求助进入处理中后不能撤回");
      }
      const withdrawnAt = new Date();
      await this.expireActiveAssignment(tx, help.id, withdrawnAt);
      const updated = await tx.helpRequest.update({
        where: { id: help.id },
        data: {
          status: "WITHDRAWN",
          withdrawnAt,
          withdrawReason: body.reason,
          currentOwnerPersonId: null,
          transferredOrganizationId: null,
        },
      });
      await writeHelpTransition(tx, {
        ...input,
        entityId: help.id,
        actionCode: "HELP_WITHDRAWN",
        fromState: "PENDING",
        toState: "WITHDRAWN",
        reason: body.reason,
      });
      await writeHelpAudit(tx, {
        ...input,
        entityId: help.id,
        actionCode: "HELP_WITHDRAWN",
        before: stateSnapshot(help),
        after: stateSnapshot(updated),
        reason: body.reason,
      });
      await this.outbox.append({
        eventType: "HELP_WITHDRAWN",
        aggregateType: "HELP_REQUEST",
        aggregateId: help.id,
        payload: { aggregateId: help.id, recipientIds: [], todoRecipientIds: [], eventKey: withdrawnAt.toISOString() },
        dedupeKey: `help:withdrawn:${help.id}`,
      }, tx);
      const detail = await this.repository.findById(tx, help.id);
      if (!detail) throw new HelpError("HELP_NOT_FOUND", "办事求助不存在");
      return this.decorateDetail(tx, detail);
    });
  }

  async reopen(input: ServiceInput & { helpRequestId: string; body: unknown }) {
    await authorizeActor({ actor: input.actor, action: "help.reopen" });
    const body = helpReasonSchema.parse(input.body);
    return this.repository.transaction(async (tx) => {
      const help = await this.requireLocked(tx, input.helpRequestId);
      if (help.submitterPersonId !== input.actor.personId) {
        throw new HelpError("HELP_FORBIDDEN", "只有提交人可以重新打开求助");
      }
      if (help.status !== "COMPLETED") {
        throw new HelpError("HELP_STATE_CONFLICT", "只有已办结求助可以重新打开");
      }
      if (!help.currentOwnerPersonId || !await this.repository.findReopenOwner(tx, help.currentOwnerPersonId)) {
        throw new HelpError(
          "HELP_STATE_CONFLICT",
          "原主办人已失效，不能生成无人负责的处理中记录，请联系管理员处理",
        );
      }
      const reopenedAt = new Date();
      const updated = await tx.helpRequest.update({
        where: { id: help.id },
        data: {
          status: "IN_PROGRESS",
          reopenedAt,
          reopenReason: body.reason,
          completedAt: null,
        },
      });
      await writeHelpTransition(tx, {
        ...input,
        entityId: help.id,
        actionCode: "HELP_REOPENED",
        fromState: "COMPLETED",
        toState: "IN_PROGRESS",
        reason: body.reason,
      });
      await writeHelpAudit(tx, {
        ...input,
        entityId: help.id,
        actionCode: "HELP_REOPENED",
        before: stateSnapshot(help),
        after: stateSnapshot(updated),
        reason: body.reason,
      });
      await this.outbox.append({
        eventType: "HELP_REOPENED",
        aggregateType: "HELP_REQUEST",
        aggregateId: help.id,
        payload: { aggregateId: help.id, recipientIds: [help.currentOwnerPersonId], todoRecipientIds: [help.currentOwnerPersonId], eventKey: reopenedAt.toISOString() },
        dedupeKey: `help:reopened:${help.id}:${reopenedAt.toISOString()}`,
      }, tx);
      const detail = await this.repository.findById(tx, help.id);
      if (!detail) throw new HelpError("HELP_NOT_FOUND", "办事求助不存在");
      return this.decorateDetail(tx, detail);
    });
  }

  async reassign(input: ServiceInput & { helpRequestId: string; body: unknown }) {
    await authorizeActor({
      actor: input.actor,
      action: "help.reassign",
      resource: { resourceType: "help_request", requiredScope: "GLOBAL_OPERATIONAL" },
    });
    const body = reassignHelpRequestSchema.parse(input.body);
    if (body.expectedCompleteAt) requireFutureExpectedDate(body.expectedCompleteAt);
    return this.repository.transaction(async (tx) => {
      const help = await this.requireLocked(tx, input.helpRequestId);
      if (help.status !== "IN_PROGRESS" || !help.currentOwnerPersonId) {
        throw new HelpError("HELP_STATE_CONFLICT", "本阶段仅支持把处理中的求助重新分派到具体人员");
      }
      if (help.currentOwnerPersonId === body.personId) {
        throw new HelpError("HELP_STATE_CONFLICT", "新主办人不能与当前主办人相同");
      }
      const assignee = await this.repository.findAssignablePerson(tx, body.personId);
      if (!assignee) throw new HelpError("HELP_PERSON_INVALID", "新主办人必须是有效且账号未停用的内部人员");
      const now = new Date();
      await this.expireActiveAssignment(tx, help.id, now);
      await tx.helpAssignmentHistory.create({
        data: {
          helpRequestId: help.id,
          personId: assignee.id,
          assignmentType: "REASSIGN",
          effectiveAt: now,
          reason: body.reason,
          changedByPersonId: input.actor.personId,
        },
      });
      const updated = await tx.helpRequest.update({
        where: { id: help.id },
        data: {
          currentOwnerPersonId: assignee.id,
          transferredOrganizationId: null,
          ...(body.expectedCompleteAt ? { expectedCompleteAt: body.expectedCompleteAt } : {}),
        },
      });
      await writeHelpTransition(tx, {
        ...input,
        entityId: help.id,
        actionCode: "HELP_REASSIGNED",
        fromState: "IN_PROGRESS",
        toState: "IN_PROGRESS",
        reason: body.reason,
        metadata: {
          fromPersonId: help.currentOwnerPersonId,
          toPersonId: assignee.id,
          expectedCompleteAt: updated.expectedCompleteAt?.toISOString() ?? null,
        },
      });
      await writeHelpAudit(tx, {
        ...input,
        entityId: help.id,
        actionCode: "HELP_REASSIGNED",
        before: stateSnapshot(help),
        after: stateSnapshot(updated),
        reason: body.reason,
      });
      await this.outbox.append({
        eventType: "HELP_REASSIGNED",
        aggregateType: "HELP_REQUEST",
        aggregateId: help.id,
        payload: { aggregateId: help.id, recipientIds: [...new Set([help.currentOwnerPersonId, assignee.id, help.submitterPersonId])], todoRecipientIds: [assignee.id], staleTodoRecipientIds: [help.currentOwnerPersonId], eventKey: now.toISOString() },
        dedupeKey: `help:reassigned:${help.id}:${now.toISOString()}`,
      }, tx);
      const detail = await this.repository.findById(tx, help.id);
      if (!detail) throw new HelpError("HELP_NOT_FOUND", "办事求助不存在");
      return this.decorateDetail(tx, detail);
    });
  }
}
