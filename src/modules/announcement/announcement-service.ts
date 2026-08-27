import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import type { AuthRequestContext } from "@/modules/identity/request-context";
import { OutboxRepository } from "@/modules/outbox/outbox-repository";
import { authorizeActor } from "@/modules/permissions/authorization";
import type { PermissionActor } from "@/modules/permissions/types";
import { completeTodos } from "@/modules/notification/notification-write-service";
import { resolveAudience } from "./audience-resolver";
import { AnnouncementError } from "./errors";
import {
  announcementListSchema,
  createAnnouncementSchema,
  pinAnnouncementSchema,
  updateAnnouncementAudienceSchema,
  updateAnnouncementSchema,
  withdrawAnnouncementSchema,
  type AnnouncementAudienceInput,
} from "./schemas";

const ENTITY = "ANNOUNCEMENT";
const VERSION_ENTITY = "ANNOUNCEMENT_VERSION";
const ATTACHMENT_RELATION = "ATTACHMENT";

type Input = { actor: PermissionActor; context?: AuthRequestContext };

function isAdmin(actor: PermissionActor) {
  return actor.effectiveRoles.includes("ADMIN") || actor.effectiveRoles.includes("SUPER_ADMIN");
}

function ruleData(rule: AnnouncementAudienceInput, announcementId: string, actorId: string, effectiveAt: Date) {
  return {
    announcementId,
    audienceType: rule.type,
    roleCode: rule.type === "ROLE" ? rule.roleCode : null,
    areaId: rule.type === "ADMINISTRATIVE_AREA" ? rule.areaId : null,
    organizationId: rule.type === "ORGANIZATION" ? rule.organizationId : null,
    personId: rule.type === "PERSON" ? rule.personId : null,
    effectiveAt,
    createdByPersonId: actorId,
  };
}

function storedRule(rule: {
  audienceType: "ALL" | "ROLE" | "ADMINISTRATIVE_AREA" | "ORGANIZATION" | "PERSON";
  roleCode: AnnouncementAudienceInput extends never ? never : string | null;
  areaId: string | null;
  organizationId: string | null;
  personId: string | null;
}): AnnouncementAudienceInput {
  if (rule.audienceType === "ROLE") return { type: "ROLE", roleCode: rule.roleCode as Extract<AnnouncementAudienceInput, { type: "ROLE" }>["roleCode"] };
  if (rule.audienceType === "ADMINISTRATIVE_AREA") return { type: "ADMINISTRATIVE_AREA", areaId: rule.areaId! };
  if (rule.audienceType === "ORGANIZATION") return { type: "ORGANIZATION", organizationId: rule.organizationId! };
  if (rule.audienceType === "PERSON") return { type: "PERSON", personId: rule.personId! };
  return { type: "ALL" };
}

async function audit(tx: Prisma.TransactionClient, input: Input & {
  actionCode: string;
  entityId: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  reason?: string;
}) {
  await tx.auditLog.create({ data: {
    actorPersonId: input.actor.personId,
    actorAccountId: input.actor.accountId,
    actionCode: input.actionCode,
    entityType: ENTITY,
    entityId: input.entityId,
    beforeJson: input.before,
    afterJson: input.after,
    reason: input.reason,
    ip: input.context?.ip,
    device: input.context?.userAgent,
    requestId: input.context?.requestId,
  } });
}

export class AnnouncementService {
  private readonly prisma = getPrismaClient();
  private readonly outbox = new OutboxRepository(this.prisma);

  private async transaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try { return await this.prisma.$transaction(operation); }
      catch (error) {
        if (attempt >= 2 || (error as { code?: string }).code !== "P2034") throw error;
      }
    }
  }

  private async lock(tx: Prisma.TransactionClient, id: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM announcements WHERE id = ${id} FOR UPDATE`;
    if (rows.length !== 1) throw new AnnouncementError("ANNOUNCEMENT_NOT_FOUND", "公告不存在");
  }

  private activeRules(tx: Prisma.TransactionClient, announcementId: string, now = new Date()) {
    return tx.announcementAudienceRule.findMany({
      where: { announcementId, effectiveAt: { lte: now }, OR: [{ expiredAt: null }, { expiredAt: { gt: now } }] },
      orderBy: [{ effectiveAt: "asc" }, { id: "asc" }],
    });
  }

  private async attach(tx: Prisma.TransactionClient, input: { versionId: string; attachmentIds: string[]; actorId: string }) {
    for (const attachmentId of [...input.attachmentIds].sort()) {
      await tx.$queryRaw`SELECT id FROM attachments WHERE id = ${attachmentId} FOR UPDATE`;
      const attachment = await tx.attachment.findUnique({ where: { id: attachmentId } });
      if (!attachment || attachment.uploadStatus !== "UPLOADED" || attachment.scanStatus !== "PASSED" || !attachment.objectKey) {
        throw new AnnouncementError("ANNOUNCEMENT_ATTACHMENT_INVALID", "公告附件尚未完成安全扫描");
      }
      await tx.attachment.update({ where: { id: attachmentId }, data: { isTemporary: false, permissionLevel: "PARENT_AUTHORIZED" } });
      await tx.attachmentLink.upsert({
        where: { attachmentId_entityType_entityId_relationType: { attachmentId, entityType: VERSION_ENTITY, entityId: input.versionId, relationType: ATTACHMENT_RELATION } },
        create: { attachmentId, entityType: VERSION_ENTITY, entityId: input.versionId, relationType: ATTACHMENT_RELATION, createdByPersonId: input.actorId },
        update: {},
      });
    }
  }

  private attachmentIds(tx: Prisma.TransactionClient, versionId: string) {
    return tx.attachmentLink.findMany({
      where: { entityType: VERSION_ENTITY, entityId: versionId, relationType: ATTACHMENT_RELATION },
      orderBy: { attachmentId: "asc" },
      select: { attachmentId: true },
    });
  }

  private async materialize(tx: Prisma.TransactionClient, versionId: string, personIds: readonly string[]) {
    for (const personId of personIds) {
      await tx.announcementRecipientState.upsert({
        where: { versionId_personId: { versionId, personId } },
        create: { versionId, personId },
        update: { revokedAt: null },
      });
    }
  }

  async create(input: Input & { body: unknown }) {
    await authorizeActor({ actor: input.actor, action: "announcement.create", resource: { resourceType: "announcement", requiredScope: "GLOBAL_OPERATIONAL" } });
    const body = createAnnouncementSchema.parse(input.body);
    return this.transaction(async (tx) => {
      const announcement = await tx.announcement.create({ data: { createdByPersonId: input.actor.personId } });
      const version = await tx.announcementVersion.create({ data: {
        announcementId: announcement.id,
        versionNo: 1,
        title: body.title,
        body: body.body,
        isImportant: body.isImportant,
        needConfirm: body.needConfirm,
        createdByPersonId: input.actor.personId,
      } });
      await tx.announcement.update({ where: { id: announcement.id }, data: { currentVersionId: version.id } });
      const now = new Date();
      await tx.announcementAudienceRule.createMany({ data: body.audience.map((rule) => ruleData(rule, announcement.id, input.actor.personId, now)) });
      await this.attach(tx, { versionId: version.id, attachmentIds: body.attachmentIds, actorId: input.actor.personId });
      await audit(tx, { ...input, actionCode: "ANNOUNCEMENT_CREATED", entityId: announcement.id, after: { versionId: version.id, versionNo: 1, audienceCount: body.audience.length } });
      return { id: announcement.id, status: "DRAFT", currentVersion: version };
    });
  }

  async publish(input: Input & { announcementId: string }) {
    await authorizeActor({ actor: input.actor, action: "announcement.publish", resource: { resourceType: "announcement", requiredScope: "GLOBAL_OPERATIONAL" } });
    return this.transaction(async (tx) => {
      await this.lock(tx, input.announcementId);
      const item = await tx.announcement.findUniqueOrThrow({ where: { id: input.announcementId }, include: { currentVersion: true } });
      if (item.status !== "DRAFT" || !item.currentVersion) throw new AnnouncementError("ANNOUNCEMENT_STATE_CONFLICT", "只有完整草稿可以发布");
      const now = new Date();
      const rules = (await this.activeRules(tx, item.id, now)).map(storedRule);
      const recipientIds = await resolveAudience(tx, rules, now);
      await this.materialize(tx, item.currentVersion.id, recipientIds);
      await tx.announcement.update({ where: { id: item.id }, data: { status: "PUBLISHED", publishedAt: now, publishedByPersonId: input.actor.personId } });
      await tx.stateTransitionHistory.create({ data: { entityType: ENTITY, entityId: item.id, fromState: "DRAFT", toState: "PUBLISHED", actionCode: "ANNOUNCEMENT_PUBLISHED", actorPersonId: input.actor.personId, requestId: input.context?.requestId } });
      await this.outbox.append({ eventType: "ANNOUNCEMENT_PUBLISHED", aggregateType: ENTITY, aggregateId: item.id, payload: { announcementId: item.id, versionId: item.currentVersion.id, recipientIds, needConfirm: item.currentVersion.needConfirm, eventKey: `v${item.currentVersion.versionNo}` }, dedupeKey: `announcement:published:${item.currentVersion.id}` }, tx);
      await audit(tx, { ...input, actionCode: "ANNOUNCEMENT_PUBLISHED", entityId: item.id, before: { status: "DRAFT" }, after: { status: "PUBLISHED", recipientCount: recipientIds.length } });
      return { id: item.id, status: "PUBLISHED", recipientCount: recipientIds.length };
    });
  }

  async update(input: Input & { announcementId: string; body: unknown }) {
    await authorizeActor({ actor: input.actor, action: "announcement.edit", resource: { resourceType: "announcement", requiredScope: "GLOBAL_OPERATIONAL" } });
    const body = updateAnnouncementSchema.parse(input.body);
    return this.transaction(async (tx) => {
      await this.lock(tx, input.announcementId);
      const item = await tx.announcement.findUniqueOrThrow({ where: { id: input.announcementId }, include: { currentVersion: true } });
      if (item.status === "WITHDRAWN" || !item.currentVersion) throw new AnnouncementError("ANNOUNCEMENT_STATE_CONFLICT", "已撤回公告不能修改正文");
      const oldAttachmentIds = (await this.attachmentIds(tx, item.currentVersion.id)).map(({ attachmentId }) => attachmentId);
      const nextAttachmentIds = [...body.attachmentIds].sort();
      const unchanged = item.currentVersion.title === body.title && item.currentVersion.body === body.body
        && item.currentVersion.isImportant === body.isImportant && item.currentVersion.needConfirm === body.needConfirm
        && JSON.stringify(oldAttachmentIds) === JSON.stringify(nextAttachmentIds);
      if (unchanged) return { id: item.id, unchanged: true, currentVersion: item.currentVersion };
      const version = await tx.announcementVersion.create({ data: {
        announcementId: item.id,
        versionNo: item.currentVersion.versionNo + 1,
        title: body.title,
        body: body.body,
        isImportant: body.isImportant,
        needConfirm: body.needConfirm,
        reason: body.reason,
        createdByPersonId: input.actor.personId,
      } });
      await this.attach(tx, { versionId: version.id, attachmentIds: nextAttachmentIds, actorId: input.actor.personId });
      await tx.announcement.update({ where: { id: item.id }, data: { currentVersionId: version.id } });
      if (item.status === "PUBLISHED") {
        const rules = (await this.activeRules(tx, item.id)).map(storedRule);
        const recipientIds = await resolveAudience(tx, rules);
        await this.materialize(tx, version.id, recipientIds);
        await this.outbox.append({ eventType: "ANNOUNCEMENT_UPDATED", aggregateType: ENTITY, aggregateId: item.id, payload: { announcementId: item.id, versionId: version.id, recipientIds, needConfirm: version.needConfirm, eventKey: `v${version.versionNo}` }, dedupeKey: `announcement:updated:${version.id}` }, tx);
      }
      await audit(tx, { ...input, actionCode: "ANNOUNCEMENT_CONTENT_UPDATED", entityId: item.id, before: { versionId: item.currentVersion.id, versionNo: item.currentVersion.versionNo }, after: { versionId: version.id, versionNo: version.versionNo }, reason: body.reason });
      return { id: item.id, unchanged: false, currentVersion: version };
    });
  }

  async updateAudience(input: Input & { announcementId: string; body: unknown }) {
    await authorizeActor({ actor: input.actor, action: "announcement.scope.change", resource: { resourceType: "announcement", requiredScope: "GLOBAL_OPERATIONAL" } });
    const body = updateAnnouncementAudienceSchema.parse(input.body);
    return this.transaction(async (tx) => {
      await this.lock(tx, input.announcementId);
      const item = await tx.announcement.findUniqueOrThrow({ where: { id: input.announcementId }, include: { currentVersion: true } });
      if (item.status === "WITHDRAWN" || !item.currentVersion) throw new AnnouncementError("ANNOUNCEMENT_STATE_CONFLICT", "已撤回公告不能变更范围");
      const now = new Date();
      await tx.announcementAudienceRule.updateMany({ where: { announcementId: item.id, expiredAt: null }, data: { expiredAt: now } });
      await tx.announcementAudienceRule.createMany({ data: body.audience.map((rule) => ruleData(rule, item.id, input.actor.personId, now)) });
      let added: string[] = [];
      let removed: string[] = [];
      if (item.status === "PUBLISHED") {
        const next = new Set(await resolveAudience(tx, body.audience, now));
        const current = await tx.announcementRecipientState.findMany({ where: { versionId: item.currentVersion.id, revokedAt: null }, select: { personId: true } });
        const previous = new Set(current.map(({ personId }) => personId));
        added = [...next].filter((id) => !previous.has(id));
        removed = [...previous].filter((id) => !next.has(id));
        await this.materialize(tx, item.currentVersion.id, added);
        if (removed.length) await tx.announcementRecipientState.updateMany({ where: { versionId: item.currentVersion.id, personId: { in: removed }, revokedAt: null }, data: { revokedAt: now } });
        const changeId = randomUUID();
        if (added.length) await this.outbox.append({ eventType: "ANNOUNCEMENT_AUDIENCE_ADDED", aggregateType: ENTITY, aggregateId: item.id, payload: { announcementId: item.id, versionId: item.currentVersion.id, recipientIds: added, needConfirm: item.currentVersion.needConfirm, eventKey: `audience:${changeId}` }, dedupeKey: `announcement:audience-added:${changeId}` }, tx);
        if (removed.length) await this.outbox.append({ eventType: "ANNOUNCEMENT_AUDIENCE_REMOVED", aggregateType: ENTITY, aggregateId: item.id, payload: { announcementId: item.id, versionId: item.currentVersion.id, recipientIds: removed, needConfirm: item.currentVersion.needConfirm, eventKey: `audience:${changeId}` }, dedupeKey: `announcement:audience-removed:${changeId}` }, tx);
      }
      await audit(tx, { ...input, actionCode: "ANNOUNCEMENT_AUDIENCE_CHANGED", entityId: item.id, after: { addedCount: added.length, removedCount: removed.length, ruleCount: body.audience.length }, reason: body.reason });
      return { id: item.id, addedCount: added.length, removedCount: removed.length };
    });
  }

  async withdraw(input: Input & { announcementId: string; body: unknown }) {
    await authorizeActor({ actor: input.actor, action: "announcement.archive", resource: { resourceType: "announcement", requiredScope: "GLOBAL_OPERATIONAL" } });
    const body = withdrawAnnouncementSchema.parse(input.body);
    return this.transaction(async (tx) => {
      await this.lock(tx, input.announcementId);
      const item = await tx.announcement.findUniqueOrThrow({ where: { id: input.announcementId }, include: { currentVersion: true } });
      if (item.status !== "PUBLISHED" || !item.currentVersion) throw new AnnouncementError("ANNOUNCEMENT_STATE_CONFLICT", "只有已发布公告可以撤回");
      const now = new Date();
      const active = await tx.announcementRecipientState.findMany({ where: { versionId: item.currentVersion.id, revokedAt: null }, select: { personId: true } });
      const recipientIds = active.map(({ personId }) => personId);
      await tx.announcementRecipientState.updateMany({ where: { versionId: item.currentVersion.id, revokedAt: null }, data: { revokedAt: now } });
      await tx.announcement.update({ where: { id: item.id }, data: { status: "WITHDRAWN", isPinned: false, pinnedKey: null, withdrawnAt: now, withdrawnByPersonId: input.actor.personId, withdrawReason: body.reason } });
      await this.outbox.append({ eventType: "ANNOUNCEMENT_WITHDRAWN", aggregateType: ENTITY, aggregateId: item.id, payload: { announcementId: item.id, versionId: item.currentVersion.id, recipientIds, needConfirm: item.currentVersion.needConfirm, eventKey: `withdrawn:${item.currentVersion.versionNo}` }, dedupeKey: `announcement:withdrawn:${item.id}` }, tx);
      await audit(tx, { ...input, actionCode: "ANNOUNCEMENT_WITHDRAWN", entityId: item.id, before: { status: "PUBLISHED" }, after: { status: "WITHDRAWN" }, reason: body.reason });
      return { id: item.id, status: "WITHDRAWN" };
    });
  }

  async pin(input: Input & { announcementId: string; body: unknown }) {
    await authorizeActor({ actor: input.actor, action: "announcement.edit", resource: { resourceType: "announcement", requiredScope: "GLOBAL_OPERATIONAL" } });
    const body = pinAnnouncementSchema.parse(input.body);
    return this.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM announcements ORDER BY id FOR UPDATE`;
      const item = await tx.announcement.findUnique({ where: { id: input.announcementId } });
      if (!item) throw new AnnouncementError("ANNOUNCEMENT_NOT_FOUND", "公告不存在");
      if (item.status !== "PUBLISHED") throw new AnnouncementError("ANNOUNCEMENT_STATE_CONFLICT", "只有已发布公告可以置顶");
      if (body.pinned) {
        await tx.announcement.updateMany({ where: { pinnedKey: 1, id: { not: item.id } }, data: { isPinned: false, pinnedKey: null } });
        await tx.announcement.update({ where: { id: item.id }, data: { isPinned: true, pinnedKey: 1 } });
      } else {
        await tx.announcement.update({ where: { id: item.id }, data: { isPinned: false, pinnedKey: null } });
      }
      await audit(tx, { ...input, actionCode: body.pinned ? "ANNOUNCEMENT_PINNED" : "ANNOUNCEMENT_UNPINNED", entityId: item.id, before: { isPinned: item.isPinned }, after: { isPinned: body.pinned } });
      return { id: item.id, isPinned: body.pinned };
    });
  }

  async read(input: Input & { announcementId: string }) {
    await authorizeActor({ actor: input.actor, action: "announcement.view" });
    return this.transaction(async (tx) => {
      const item = await tx.announcement.findUnique({ where: { id: input.announcementId }, include: { currentVersion: true } });
      if (!item?.currentVersion || item.status !== "PUBLISHED") throw new AnnouncementError("ANNOUNCEMENT_NOT_FOUND", "公告不存在");
      const state = await tx.announcementRecipientState.findUnique({ where: { versionId_personId: { versionId: item.currentVersion.id, personId: input.actor.personId } } });
      if (!state || state.revokedAt) throw new AnnouncementError("ANNOUNCEMENT_NOT_FOUND", "公告不存在");
      const readAt = state.readAt ?? new Date();
      if (!state.readAt) await tx.announcementRecipientState.update({ where: { id: state.id }, data: { readAt } });
      return { announcementId: item.id, versionId: item.currentVersion.id, readAt };
    });
  }

  async confirm(input: Input & { announcementId: string }) {
    await authorizeActor({ actor: input.actor, action: "announcement.confirm" });
    return this.transaction(async (tx) => {
      await this.lock(tx, input.announcementId);
      const item = await tx.announcement.findUniqueOrThrow({ where: { id: input.announcementId }, include: { currentVersion: true } });
      if (!item.currentVersion || item.status !== "PUBLISHED") throw new AnnouncementError("ANNOUNCEMENT_NOT_FOUND", "公告不存在");
      if (!item.currentVersion.needConfirm) throw new AnnouncementError("ANNOUNCEMENT_CONFIRM_NOT_REQUIRED", "该公告无需确认");
      const state = await tx.announcementRecipientState.findUnique({ where: { versionId_personId: { versionId: item.currentVersion.id, personId: input.actor.personId } } });
      if (!state || state.revokedAt) throw new AnnouncementError("ANNOUNCEMENT_NOT_FOUND", "公告不存在");
      const confirmedAt = state.confirmedAt ?? new Date();
      if (!state.confirmedAt) await tx.announcementRecipientState.update({ where: { id: state.id }, data: { confirmedAt } });
      await completeTodos(tx, { aggregateType: ENTITY, aggregateId: item.id, personIds: [input.actor.personId], todoType: "ANNOUNCEMENT_CONFIRM", now: confirmedAt });
      return { announcementId: item.id, versionId: item.currentVersion.id, confirmedAt };
    });
  }

  async list(input: Input & { query: unknown }) {
    await authorizeActor({ actor: input.actor, action: "announcement.view" });
    const query = announcementListSchema.parse(input.query);
    const admin = isAdmin(input.actor);
    const where: Prisma.AnnouncementWhereInput = admin ? {} : {
      status: "PUBLISHED",
      currentVersion: { is: { recipientStates: { some: { personId: input.actor.personId, revokedAt: null } } } },
    };
    const [total, items] = await Promise.all([
      this.prisma.announcement.count({ where }),
      this.prisma.announcement.findMany({
        where,
        include: { currentVersion: { include: { recipientStates: { where: { personId: input.actor.personId } } } } },
        orderBy: [{ isPinned: "desc" }, { publishedAt: "desc" }, { createdAt: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items, total, ...query };
  }

  async detail(input: Input & { announcementId: string }) {
    await authorizeActor({ actor: input.actor, action: "announcement.view" });
    const admin = isAdmin(input.actor);
    const item = await this.prisma.announcement.findFirst({
      where: admin ? { id: input.announcementId } : {
        id: input.announcementId,
        status: "PUBLISHED",
        currentVersion: { is: { recipientStates: { some: { personId: input.actor.personId, revokedAt: null } } } },
      },
      include: {
        currentVersion: { include: { recipientStates: { where: { personId: input.actor.personId } } } },
        ...(admin ? { versions: { orderBy: { versionNo: "desc" as const } }, audienceRules: { orderBy: { effectiveAt: "desc" as const } } } : {}),
      },
    });
    if (!item?.currentVersion) throw new AnnouncementError("ANNOUNCEMENT_NOT_FOUND", "公告不存在");
    const links = await this.prisma.attachmentLink.findMany({ where: { entityType: VERSION_ENTITY, entityId: item.currentVersion.id, relationType: ATTACHMENT_RELATION }, include: { attachment: { select: { id: true, originalFilename: true, actualSizeBytes: true, scanStatus: true } } } });
    return { ...item, attachments: links.map(({ attachment }) => ({ ...attachment, actualSizeBytes: attachment.actualSizeBytes === null ? null : Number(attachment.actualSizeBytes) })) };
  }

  async confirmationStatus(input: Input & { announcementId: string }) {
    await authorizeActor({ actor: input.actor, action: "announcement.edit", resource: { resourceType: "announcement", requiredScope: "GLOBAL_OPERATIONAL" } });
    const item = await this.prisma.announcement.findUnique({ where: { id: input.announcementId }, include: { currentVersion: { include: { recipientStates: { include: { person: { select: { id: true, name: true } } } } } } } });
    if (!item?.currentVersion) throw new AnnouncementError("ANNOUNCEMENT_NOT_FOUND", "公告不存在");
    const active = item.currentVersion.recipientStates.filter(({ revokedAt }) => !revokedAt);
    return { versionId: item.currentVersion.id, total: active.length, confirmed: active.filter(({ confirmedAt }) => confirmedAt).length, recipients: active.map(({ person, readAt, confirmedAt }) => ({ person, readAt, confirmedAt })) };
  }

  async getTopVisibleAnnouncement(actor: PermissionActor) {
    const base = { status: "PUBLISHED" as const, currentVersion: { is: { recipientStates: { some: { personId: actor.personId, revokedAt: null } } } } };
    const include = { currentVersion: { include: { recipientStates: { where: { personId: actor.personId } } } } };
    const important = await this.prisma.announcement.findFirst({ where: { ...base, currentVersion: { is: { needConfirm: true, isImportant: true, recipientStates: { some: { personId: actor.personId, revokedAt: null, confirmedAt: null } } } } }, include, orderBy: { publishedAt: "desc" } });
    if (important) return important;
    const pinned = await this.prisma.announcement.findFirst({ where: { ...base, isPinned: true }, include, orderBy: { publishedAt: "desc" } });
    if (pinned) return pinned;
    return this.prisma.announcement.findFirst({ where: base, include, orderBy: { publishedAt: "desc" } });
  }
}
