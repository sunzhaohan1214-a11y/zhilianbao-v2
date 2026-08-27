import { createHash } from "node:crypto";
import type { Prisma, Trip } from "@/generated/prisma/client";
import { authorizeActor } from "@/modules/permissions/authorization";
import type { PermissionActor } from "@/modules/permissions/types";
import { DemandLeadService } from "@/modules/demand";
import { writeTripAudit, writeTripTransition, type TripMutationContext } from "./audit";
import {
  ENTERPRISE_VISIT_ENTITY,
  TRIP_ENTITY,
  TRIP_RESULT_ATTACHMENT_RELATION,
  VISIT_ATTACHMENT_RELATION,
} from "./constants";
import { isUniqueConflict, TripError } from "./errors";
import { TripRepository, tripDetailInclude, type TripTransaction } from "./repository/trip-repository";
import {
  idempotencyKeySchema,
  tripCancelSchema,
  tripCorrectionSchema,
  tripCreateSchema,
  tripListQuerySchema,
  tripParticipantSchema,
  tripResultSchema,
  tripResultUpdateSchema,
  tripUpdateSchema,
  visitCorrectionSchema,
  visitDemandLeadSchema,
  visitSupplementSchema,
  type TripNodeInput,
  type TripUpdateInput,
} from "./schemas";
import { deriveTripStatus, effectiveTripEnd, shanghaiDateKey, type TripStatus } from "./status";

type ServiceInput = { actor: PermissionActor; context?: TripMutationContext };

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableHash(value: unknown): string {
  return sha256(JSON.stringify(value, (_key, item) => {
    if (item instanceof Date) return item.toISOString();
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)));
    }
    return item;
  }));
}

function normalizeOptional(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value.trim() === "") return null;
  return value.trim();
}

function tripSnapshot(trip: Pick<Trip,
  "id" | "title" | "purpose" | "note" | "overallEndAt" | "createdByPersonId"
  | "canceledAt" | "canceledByPersonId" | "cancelReason"
> & { nodes?: readonly { id: string; sequenceNo: number; plannedStartAt: Date; plannedEndAt: Date | null; enterpriseId: string | null; locationName: string; address: string | null; content: string; nodeResultSummary?: string | null }[] }): Prisma.InputJsonObject {
  return {
    id: trip.id,
    title: trip.title,
    purpose: trip.purpose,
    note: trip.note,
    overallEndAt: trip.overallEndAt?.toISOString() ?? null,
    createdByPersonId: trip.createdByPersonId,
    canceledAt: trip.canceledAt?.toISOString() ?? null,
    canceledByPersonId: trip.canceledByPersonId,
    cancelReason: trip.cancelReason,
    ...(trip.nodes ? { nodes: trip.nodes.map((node) => ({
      id: node.id,
      sequenceNo: node.sequenceNo,
      plannedStartAt: node.plannedStartAt.toISOString(),
      plannedEndAt: node.plannedEndAt?.toISOString() ?? null,
      enterpriseId: node.enterpriseId,
      locationName: node.locationName,
      address: node.address,
      content: node.content,
      nodeResultSummary: node.nodeResultSummary ?? null,
    })) } : {}),
  };
}

function adminActor(actor: PermissionActor): boolean {
  return actor.effectiveRoles.includes("ADMIN") || actor.effectiveRoles.includes("SUPER_ADMIN");
}

function organizerActor(actor: PermissionActor): boolean {
  return adminActor(actor)
    || actor.effectiveRoles.includes("TOWNSHIP_STAFF")
    || actor.effectiveRoles.includes("DEPARTMENT_STAFF")
    || actor.capabilities.has("trip.create.team");
}

function shanghaiDayBounds(at: Date): { start: Date; end: Date } {
  const day = shanghaiDateKey(at);
  return {
    start: new Date(`${day}T00:00:00.000+08:00`),
    end: new Date(`${day}T23:59:59.999+08:00`),
  };
}

export function isEligibleTripParticipant(person: { personStatus: string; account?: { status: string } | null }): boolean {
  return person.personStatus === "ACTIVE" && Boolean(person.account) && person.account?.status !== "DISABLED";
}

export function isLastActiveTripParticipant(participants: readonly { leftAt: Date | null }[]): boolean {
  return participants.filter(({ leftAt }) => leftAt === null).length <= 1;
}

export function tripTimeRange(
  nodes: readonly { plannedStartAt: Date; plannedEndAt?: Date | null }[],
  overallEndAt?: Date | null,
): { start: Date; end: Date } {
  const starts = nodes.map(({ plannedStartAt }) => plannedStartAt.getTime());
  const ends = nodes.map((item) => (item.plannedEndAt ?? item.plannedStartAt).getTime());
  if (starts.length === 0) throw new TripError("TRIP_NODE_INVALID", "行程至少需要一个节点");
  return { start: new Date(Math.min(...starts)), end: overallEndAt ?? new Date(Math.max(...ends)) };
}

export function matchesTripDuplicateCandidate(
  requested: readonly { enterpriseId?: string | null; locationName: string; plannedStartAt: Date }[],
  existing: readonly { enterpriseId?: string | null; locationName: string; plannedStartAt: Date }[],
): boolean {
  const enterpriseIds = new Set(requested.flatMap((item) => item.enterpriseId ? [item.enterpriseId] : []));
  const locations = new Set(requested.map((item) => item.locationName.trim().toLocaleLowerCase("zh-CN")));
  return existing.some((candidate) => {
    const identityMatch = candidate.enterpriseId
      ? enterpriseIds.has(candidate.enterpriseId)
      : locations.has(candidate.locationName.trim().toLocaleLowerCase("zh-CN"));
    if (!identityMatch) return false;
    return requested.some((item) => (
      shanghaiDateKey(item.plannedStartAt) === shanghaiDateKey(candidate.plannedStartAt)
      && Math.abs(item.plannedStartAt.getTime() - candidate.plannedStartAt.getTime()) <= 2 * 60 * 60 * 1000
    ));
  });
}

export function validateTripNodes(nodes: readonly TripNodeInput[], overallEndAt?: Date | null) {
  if (nodes.length === 0) throw new TripError("TRIP_NODE_INVALID", "行程至少需要一个节点");
  const enterpriseIds = new Set<string>();
  const day = shanghaiDateKey(nodes[0].plannedStartAt);
  if (overallEndAt && shanghaiDateKey(overallEndAt) !== day) {
    throw new TripError("TRIP_NODE_INVALID", "总体结束时间必须与行程节点位于同一个北京时间自然日");
  }
  let previousStart: Date | undefined;
  let latestMoment = nodes[0].plannedStartAt;
  return nodes.map((node, index) => {
    if (node.plannedEndAt && node.plannedEndAt <= node.plannedStartAt) {
      throw new TripError("TRIP_NODE_INVALID", `第 ${index + 1} 个节点的结束时间必须晚于开始时间`);
    }
    if (previousStart && node.plannedStartAt < previousStart) {
      throw new TripError("TRIP_NODE_INVALID", "节点时间必须按行程顺序排列");
    }
    if (shanghaiDateKey(node.plannedStartAt) !== day) {
      throw new TripError("TRIP_NODE_INVALID", "同一行程的节点必须位于同一个北京时间自然日");
    }
    if (node.plannedEndAt && shanghaiDateKey(node.plannedEndAt) !== day) {
      throw new TripError("TRIP_NODE_INVALID", `第 ${index + 1} 个节点的结束时间必须与行程位于同一个北京时间自然日`);
    }
    if (node.enterpriseId) {
      if (enterpriseIds.has(node.enterpriseId)) {
        throw new TripError("TRIP_DUPLICATE_ENTERPRISE", "同一行程不能重复选择同一家企业");
      }
      enterpriseIds.add(node.enterpriseId);
    }
    previousStart = node.plannedStartAt;
    const nodeEnd = node.plannedEndAt ?? node.plannedStartAt;
    if (nodeEnd > latestMoment) latestMoment = nodeEnd;
    return {
      sequenceNo: index + 1,
      plannedStartAt: node.plannedStartAt,
      plannedEndAt: node.plannedEndAt,
      enterpriseId: node.enterpriseId,
      locationName: node.locationName.trim(),
      address: normalizeOptional(node.address),
      content: node.content.trim(),
    };
  }).map((node, index, normalized) => {
    if (index === normalized.length - 1 && overallEndAt && overallEndAt < latestMoment) {
      throw new TripError("TRIP_NODE_INVALID", "总体结束时间不能早于最后一个节点时间");
    }
    return node;
  });
}

function finalTripSchedule(
  trip: { nodes: readonly { plannedStartAt: Date; plannedEndAt: Date | null; enterpriseId: string | null; locationName: string; address: string | null; content: string }[]; overallEndAt: Date | null },
  changes: TripUpdateInput,
): { nodes: TripNodeInput[]; overallEndAt: Date | null } {
  return {
    nodes: changes.nodes ?? trip.nodes.map((node) => ({
      plannedStartAt: node.plannedStartAt,
      plannedEndAt: node.plannedEndAt ?? undefined,
      enterpriseId: node.enterpriseId ?? undefined,
      locationName: node.locationName,
      address: node.address,
      content: node.content,
    })),
    overallEndAt: changes.overallEndAt !== undefined ? changes.overallEndAt : trip.overallEndAt,
  };
}

function hasActiveParticipant(
  trip: { participants: readonly { personId: string; leftAt: Date | null }[] },
  personId: string,
): boolean {
  return trip.participants.some((participant) => participant.personId === personId && participant.leftAt === null);
}

export class TripService {
  constructor(
    private readonly repository = new TripRepository(),
    private readonly demandLeadService = new DemandLeadService(),
  ) {}

  private async lockAndRequireTrip(tx: TripTransaction, tripId: string) {
    try {
      await this.repository.lockTrip(tx, tripId);
    } catch (error) {
      if ((error as Error).message === "TRIP_LOCK_TARGET_NOT_FOUND") {
        throw new TripError("TRIP_NOT_FOUND", "行程不存在");
      }
      throw error;
    }
    const trip = await this.repository.findTrip(tx, tripId);
    if (!trip) throw new TripError("TRIP_NOT_FOUND", "行程不存在");
    return trip;
  }

  private async lockAndRequireVisit(tx: TripTransaction, visitId: string) {
    const initial = await tx.enterpriseVisit.findUnique({ where: { id: visitId }, select: { tripId: true } });
    if (!initial) throw new TripError("VISIT_NOT_FOUND", "企业走访不存在");
    await this.repository.lockTrip(tx, initial.tripId);
    try {
      await this.repository.lockVisit(tx, visitId);
    } catch (error) {
      if ((error as Error).message === "VISIT_LOCK_TARGET_NOT_FOUND") {
        throw new TripError("VISIT_NOT_FOUND", "企业走访不存在");
      }
      throw error;
    }
    const visit = await tx.enterpriseVisit.findUnique({
      where: { id: visitId },
      include: {
        trip: { include: { participants: true } },
        enterprise: true,
        supplements: { orderBy: { createdAt: "asc" } },
        demandLeads: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!visit) throw new TripError("VISIT_NOT_FOUND", "企业走访不存在");
    return visit;
  }

  private async lockNormalEnterprises(tx: TripTransaction, enterpriseIds: readonly string[]) {
    for (const id of [...new Set(enterpriseIds)].sort()) {
      const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status FROM enterprises WHERE id = ${id} FOR UPDATE
      `;
      if (rows.length !== 1 || rows[0].status !== "NORMAL") {
        throw new TripError("TRIP_NODE_INVALID", "只能选择正常状态的正式企业");
      }
    }
  }

  private async requireEligibleParticipants(tx: TripTransaction, personIds: readonly string[]) {
    const unique = [...new Set(personIds)].sort();
    for (const personId of unique) {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM persons WHERE id = ${personId} FOR UPDATE
      `;
      if (rows.length !== 1) throw new TripError("TRIP_PARTICIPANT_INVALID", "参与人不存在或不可用");
      const person = await tx.person.findUnique({ where: { id: personId }, include: { account: true } });
      if (!person || !isEligibleTripParticipant(person)) {
        throw new TripError("TRIP_PARTICIPANT_INVALID", "参与人必须有效、已有账号，且账号不得处于停用状态");
      }
    }
  }

  private async requireAlumniPresence(
    tx: TripTransaction,
    actor: PermissionActor,
    nodes: readonly { plannedStartAt: Date; plannedEndAt?: Date | null }[],
    overallEndAt?: Date | null,
  ) {
    const alumniOnly = actor.effectiveRoles.includes("MEMBER_ALUMNI_PLATFORM") && !actor.currentBatchMember;
    if (!alumniOnly) return;
    const { start, end } = tripTimeRange(nodes, overallEndAt);
    const presence = await tx.presenceReport.findFirst({ where: {
      personId: actor.personId,
      canceledAt: null,
      arrivalAt: { lte: start },
      expectedDepartureAt: { gte: end },
    }, select: { id: true } });
    if (!presence) {
      throw new TripError("TRIP_ALUMNI_PRESENCE_REQUIRED", "往届团员行程必须位于本人一段有效来宝报备时间内");
    }
  }

  private async linkAttachments(
    tx: TripTransaction,
    input: { attachmentIds: readonly string[]; actorPersonId: string; entityType: string; entityId: string; relationType: string },
  ) {
    for (const attachmentId of [...new Set(input.attachmentIds)].sort()) {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM attachments WHERE id = ${attachmentId} FOR UPDATE
      `;
      if (rows.length !== 1) throw new TripError("TRIP_ATTACHMENT_INVALID", "附件不存在或已失效");
      const attachment = await tx.attachment.findUniqueOrThrow({ where: { id: attachmentId } });
      if (
        attachment.uploadedByPersonId !== input.actorPersonId
        || !attachment.isTemporary
        || attachment.uploadStatus !== "UPLOADED"
        || !["PENDING", "SCANNING", "PASSED"].includes(attachment.scanStatus)
      ) {
        throw new TripError("TRIP_ATTACHMENT_INVALID", "附件当前状态或归属不允许关联行程");
      }
      await tx.attachmentLink.create({ data: {
        attachmentId,
        entityType: input.entityType,
        entityId: input.entityId,
        relationType: input.relationType,
        createdByPersonId: input.actorPersonId,
      } });
      await tx.attachment.update({ where: { id: attachmentId }, data: { isTemporary: false } });
    }
  }

  private async duplicateCandidates(nodes: readonly TripNodeInput[]) {
    const { start, end } = shanghaiDayBounds(nodes[0].plannedStartAt);
    const trips = await this.repository.prisma.trip.findMany({
      where: {
        canceledAt: null,
        result: null,
        nodes: { some: { plannedStartAt: { gte: start, lte: end } } },
      },
      include: { nodes: { orderBy: { sequenceNo: "asc" } }, participants: { where: { leftAt: null }, select: { personId: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return trips.filter((trip) => matchesTripDuplicateCandidate(nodes, trip.nodes)).slice(0, 5).map((trip) => ({
      id: trip.id,
      title: trip.title,
      firstNodeAt: trip.nodes[0]?.plannedStartAt,
      locations: trip.nodes.map(({ locationName }) => locationName),
      activeParticipantCount: trip.participants.length,
    }));
  }

  async create(input: ServiceInput & { body: unknown }) {
    const body = tripCreateSchema.parse(input.body);
    const normalizedNodes = validateTripNodes(body.nodes, body.overallEndAt);
    const participants = [...new Set([input.actor.personId, ...body.participantIds])];
    const alumniOnly = input.actor.effectiveRoles.includes("MEMBER_ALUMNI_PLATFORM") && !input.actor.currentBatchMember;
    if (alumniOnly && participants.some((id) => id !== input.actor.personId)) {
      throw new TripError("TRIP_FORBIDDEN", "往届团员只能创建本人行程，不能添加其他参与人");
    }
    if (participants.length === 1) {
      if (input.actor.capabilities.has("trip.create.self")) {
        await authorizeActor({ actor: input.actor, action: "trip.create.self", resource: {
          resourceType: "trip", requiredScope: "SELF", ownerPersonId: input.actor.personId,
        } });
      } else {
        await authorizeActor({ actor: input.actor, action: "trip.create.team" });
      }
    } else if (input.actor.capabilities.has("trip.create.shared")) {
      await authorizeActor({ actor: input.actor, action: "trip.create.shared" });
    } else {
      await authorizeActor({ actor: input.actor, action: "trip.create.team" });
    }

    const candidates = await this.duplicateCandidates(body.nodes);
    const duplicateDecision = body.duplicateDecision;
    if (candidates.length > 0 && duplicateDecision?.action !== "CONTINUE_CREATE") {
      if (duplicateDecision?.action === "JOIN_EXISTING") {
        if (!candidates.some(({ id }) => id === duplicateDecision.tripId)) {
          throw new TripError("TRIP_SIMILAR_FOUND", "指定行程不在当前相似候选中", { candidates });
        }
        await this.addParticipant({ ...input, tripId: duplicateDecision.tripId, body: { personId: input.actor.personId } });
        return this.get({ actor: input.actor, tripId: duplicateDecision.tripId });
      }
      throw new TripError("TRIP_SIMILAR_FOUND", "已有相似行程，可选择加入或确认继续创建", { candidates });
    }

    return this.repository.transaction(async (tx) => {
      await this.requireEligibleParticipants(tx, participants);
      await this.lockNormalEnterprises(tx, normalizedNodes.flatMap((node) => node.enterpriseId ? [node.enterpriseId] : []));
      await this.requireAlumniPresence(tx, input.actor, normalizedNodes, body.overallEndAt);
      const trip = await tx.trip.create({ data: {
        title: body.title.trim(),
        purpose: body.purpose.trim(),
        note: normalizeOptional(body.note),
        sharingRestricted: alumniOnly,
        overallEndAt: body.overallEndAt,
        createdByPersonId: input.actor.personId,
        participants: { create: participants.map((personId) => ({
          personId,
          isCreator: personId === input.actor.personId,
          addedByPersonId: input.actor.personId,
        })) },
        nodes: { create: normalizedNodes },
      }, include: tripDetailInclude });
      await writeTripAudit(tx, {
        ...input,
        actionCode: "TRIP_CREATED",
        entityType: "TRIP",
        entityId: trip.id,
        after: tripSnapshot(trip),
      });
      return this.present(trip);
    });
  }

  async addParticipant(input: ServiceInput & { tripId: string; body: unknown }) {
    const { personId } = tripParticipantSchema.parse(input.body);
    await authorizeActor({ actor: input.actor, action: "trip.participant.join" });
    return this.repository.transaction(async (tx) => {
      const trip = await this.lockAndRequireTrip(tx, input.tripId);
      if (trip.canceledAt || trip.result) throw new TripError("TRIP_STATE_CONFLICT", "已取消或已完成行程不能再加入参与人");
      const selfJoin = personId === input.actor.personId;
      if (!selfJoin && trip.sharingRestricted) {
        throw new TripError("TRIP_FORBIDDEN", "往届团员创建的个人行程不能添加其他参与人");
      }
      if (!selfJoin && !(trip.createdByPersonId === input.actor.personId || organizerActor(input.actor))) {
        throw new TripError("TRIP_FORBIDDEN", "只有创建人或有组织行程能力的人员可添加他人");
      }
      if (!selfJoin && input.actor.effectiveRoles.includes("MEMBER_ALUMNI_PLATFORM") && !input.actor.currentBatchMember) {
        throw new TripError("TRIP_FORBIDDEN", "往届团员不能代表组织添加其他人员");
      }
      await this.requireEligibleParticipants(tx, [personId]);
      const existing = trip.participants.find((participant) => participant.personId === personId);
      if (existing?.leftAt === null) throw new TripError("TRIP_PARTICIPANT_ALREADY_ACTIVE", "该人员已在行程参与人中");
      const participant = existing
        ? await tx.tripParticipant.update({ where: { id: existing.id }, data: {
            joinedAt: new Date(), leftAt: null, addedByPersonId: input.actor.personId,
          } })
        : await tx.tripParticipant.create({ data: {
            tripId: trip.id, personId, addedByPersonId: input.actor.personId,
          } });
      await writeTripAudit(tx, {
        ...input, actionCode: existing ? "TRIP_PARTICIPANT_REJOINED" : "TRIP_PARTICIPANT_ADDED",
        entityType: "TRIP_PARTICIPANT", entityId: participant.id,
        after: { tripId: trip.id, personId, joinedAt: participant.joinedAt.toISOString(), leftAt: null },
      });
      await tx.stateTransitionHistory.create({ data: {
        entityType: "TRIP_PARTICIPANT", entityId: participant.id,
        fromState: existing ? "LEFT" : null, toState: "ACTIVE",
        actionCode: existing ? "TRIP_PARTICIPANT_REJOINED" : "TRIP_PARTICIPANT_ADDED",
        actorPersonId: input.actor.personId,
        requestId: input.context?.requestId,
      } });
      return participant;
    });
  }

  async leave(input: ServiceInput & { tripId: string }) {
    await authorizeActor({ actor: input.actor, action: "trip.participant.leave" });
    return this.repository.transaction(async (tx) => {
      const trip = await this.lockAndRequireTrip(tx, input.tripId);
      if (trip.canceledAt || trip.result) throw new TripError("TRIP_STATE_CONFLICT", "已取消或已完成行程不能退出");
      const participant = trip.participants.find(({ personId }) => personId === input.actor.personId);
      if (!participant || participant.leftAt) throw new TripError("TRIP_PARTICIPANT_NOT_ACTIVE", "当前账号不是该行程的有效参与人");
      if (isLastActiveTripParticipant(trip.participants)) {
        throw new TripError("TRIP_LAST_PARTICIPANT_CANNOT_LEAVE", "最后一名参与人不能退出，请由创建人或管理员取消行程");
      }
      const leftAt = new Date();
      const updated = await tx.tripParticipant.update({ where: { id: participant.id }, data: { leftAt } });
      await writeTripAudit(tx, {
        ...input, actionCode: "TRIP_PARTICIPANT_LEFT", entityType: "TRIP_PARTICIPANT", entityId: participant.id,
        before: { tripId: trip.id, personId: participant.personId, leftAt: null },
        after: { tripId: trip.id, personId: participant.personId, leftAt: leftAt.toISOString() },
      });
      await tx.stateTransitionHistory.create({ data: {
        entityType: "TRIP_PARTICIPANT", entityId: participant.id,
        fromState: "ACTIVE", toState: "LEFT", actionCode: "TRIP_PARTICIPANT_LEFT",
        actorPersonId: input.actor.personId, requestId: input.context?.requestId,
      } });
      return updated;
    });
  }

  private async applyTripUpdate(tx: TripTransaction, trip: Awaited<ReturnType<TripRepository["findTrip"]>> & {}, changes: TripUpdateInput) {
    if (!trip) throw new TripError("TRIP_NOT_FOUND", "行程不存在");
    let normalizedNodes;
    if (changes.nodes !== undefined || changes.overallEndAt !== undefined) {
      const candidate = finalTripSchedule(trip, changes);
      const validatedNodes = validateTripNodes(candidate.nodes, candidate.overallEndAt);
      normalizedNodes = changes.nodes === undefined ? undefined : validatedNodes;
    }
    if (normalizedNodes) {
      await this.lockNormalEnterprises(tx, normalizedNodes.flatMap((node) => node.enterpriseId ? [node.enterpriseId] : []));
    }
    await tx.trip.update({ where: { id: trip.id }, data: {
      title: changes.title?.trim(),
      purpose: changes.purpose?.trim(),
      note: normalizeOptional(changes.note),
      overallEndAt: changes.overallEndAt,
    } });
    if (normalizedNodes) {
      await tx.tripNode.deleteMany({ where: { tripId: trip.id } });
      await tx.tripNode.createMany({ data: normalizedNodes.map((node) => ({ ...node, tripId: trip.id })) });
    }
    return tx.trip.findUniqueOrThrow({ where: { id: trip.id }, include: tripDetailInclude });
  }

  async update(input: ServiceInput & { tripId: string; body: unknown }) {
    await authorizeActor({ actor: input.actor, action: "trip.update" });
    const changes = tripUpdateSchema.parse(input.body);
    return this.repository.transaction(async (tx) => {
      const trip = await this.lockAndRequireTrip(tx, input.tripId);
      if (trip.createdByPersonId !== input.actor.personId) throw new TripError("TRIP_FORBIDDEN", "只有创建人可修改核心行程");
      if (trip.canceledAt || trip.result) throw new TripError("TRIP_STATE_CONFLICT", "已取消或已完成行程的核心事实已锁定");
      if (changes.nodes !== undefined || changes.overallEndAt !== undefined) {
        const candidate = finalTripSchedule(trip, changes);
        validateTripNodes(candidate.nodes, candidate.overallEndAt);
        await this.requireAlumniPresence(tx, input.actor, candidate.nodes, candidate.overallEndAt);
      }
      const updated = await this.applyTripUpdate(tx, trip, changes);
      await writeTripAudit(tx, {
        ...input, actionCode: "TRIP_UPDATED", entityType: "TRIP", entityId: trip.id,
        before: tripSnapshot(trip), after: tripSnapshot(updated),
      });
      return this.present(updated);
    });
  }

  async cancel(input: ServiceInput & { tripId: string; body: unknown; now?: Date }) {
    await authorizeActor({ actor: input.actor, action: "trip.cancel" });
    const { reason } = tripCancelSchema.parse(input.body);
    const now = input.now ?? new Date();
    return this.repository.transaction(async (tx) => {
      const trip = await this.lockAndRequireTrip(tx, input.tripId);
      if (!(trip.createdByPersonId === input.actor.personId || adminActor(input.actor))) {
        throw new TripError("TRIP_FORBIDDEN", "只有创建人或管理员可取消行程");
      }
      if (trip.result) throw new TripError("TRIP_STATE_CONFLICT", "已完成行程不能取消");
      if (trip.canceledAt) return this.present(trip, now);
      const fromState = deriveTripStatus(trip, now);
      await tx.trip.update({ where: { id: trip.id }, data: {
        canceledAt: now, canceledByPersonId: input.actor.personId, cancelReason: reason,
      } });
      const updated = await tx.trip.findUniqueOrThrow({ where: { id: trip.id }, include: tripDetailInclude });
      await writeTripAudit(tx, {
        ...input, actionCode: "TRIP_CANCELED", entityType: "TRIP", entityId: trip.id,
        before: tripSnapshot(trip), after: tripSnapshot(updated), reason,
      });
      await writeTripTransition(tx, {
        ...input, entityId: trip.id, fromState, toState: "CANCELED", actionCode: "TRIP_CANCELED", reason,
      });
      return this.present(updated, now);
    });
  }

  private async existingResultForKey(actorPersonId: string, keyHash: string) {
    return this.repository.prisma.tripIdempotency.findUnique({
      where: { actorPersonId_actionCode_keyHash: { actorPersonId, actionCode: "TRIP_RESULT_SUBMIT", keyHash } },
      include: { tripResult: true },
    });
  }

  async submitResult(input: ServiceInput & { tripId: string; body: unknown; idempotencyKey: string | null; now?: Date }) {
    await authorizeActor({ actor: input.actor, action: "trip.result.submit" });
    if (!input.idempotencyKey) throw new TripError("TRIP_IDEMPOTENCY_REQUIRED", "提交行程结果必须提供 Idempotency-Key");
    const key = idempotencyKeySchema.parse(input.idempotencyKey);
    const body = tripResultSchema.parse(input.body);
    const keyHash = sha256(`TRIP_RESULT_SUBMIT:${key}`);
    const payloadHash = stableHash(body);
    const existing = await this.existingResultForKey(input.actor.personId, keyHash);
    if (existing) {
      if (existing.payloadHash !== payloadHash || existing.tripId !== input.tripId) {
        throw new TripError("TRIP_IDEMPOTENCY_CONFLICT", "同一 Idempotency-Key 不能用于不同结果内容");
      }
      return this.get({ actor: input.actor, tripId: input.tripId });
    }
    const now = input.now ?? new Date();
    try {
      return await this.repository.transaction(async (tx) => {
        const trip = await this.lockAndRequireTrip(tx, input.tripId);
        const mapped = await tx.tripIdempotency.findUnique({
          where: { actorPersonId_actionCode_keyHash: {
            actorPersonId: input.actor.personId, actionCode: "TRIP_RESULT_SUBMIT", keyHash,
          } },
        });
        if (mapped) {
          if (mapped.payloadHash !== payloadHash || mapped.tripId !== trip.id) {
            throw new TripError("TRIP_IDEMPOTENCY_CONFLICT", "同一 Idempotency-Key 不能用于不同结果内容");
          }
          return this.present(trip, now);
        }
        if (trip.canceledAt) throw new TripError("TRIP_STATE_CONFLICT", "已取消行程不能提交结果");
        if (trip.result) throw new TripError("TRIP_RESULT_ALREADY_EXISTS", "该共享行程已经提交过正式结果", { resultId: trip.result.id });
        if (!(hasActiveParticipant(trip, input.actor.personId) || trip.createdByPersonId === input.actor.personId || adminActor(input.actor))) {
          throw new TripError("TRIP_FORBIDDEN", "只有有效参与人、创建人或管理员可提交结果");
        }
        const fromState = deriveTripStatus(trip, now);
        if (fromState === "PLANNED" && !adminActor(input.actor)) {
          throw new TripError("TRIP_STATE_CONFLICT", "行程尚未开始，不能提前提交完成结果");
        }
        const nodeIds = new Set(trip.nodes.map(({ id }) => id));
        const submittedNodeIds = new Set<string>();
        for (const nodeResult of body.nodeResults) {
          if (!nodeIds.has(nodeResult.tripNodeId) || submittedNodeIds.has(nodeResult.tripNodeId)) {
            throw new TripError("TRIP_NODE_INVALID", "节点结果必须唯一且属于当前行程");
          }
          submittedNodeIds.add(nodeResult.tripNodeId);
          await tx.tripNode.update({ where: { id: nodeResult.tripNodeId }, data: {
            nodeResultSummary: normalizeOptional(nodeResult.resultSummary),
          } });
        }
        const result = await tx.tripResult.create({ data: {
          tripId: trip.id,
          resultSummary: body.resultSummary,
          nextStep: normalizeOptional(body.nextStep),
          submittedByPersonId: input.actor.personId,
          submittedAt: now,
        } });
        const summaryByNode = new Map(body.nodeResults.map((item) => [item.tripNodeId, normalizeOptional(item.resultSummary)]));
        for (const node of trip.nodes.filter((item) => item.enterpriseId)) {
          await tx.enterpriseVisit.create({ data: {
            tripId: trip.id,
            tripNodeId: node.id,
            enterpriseId: node.enterpriseId!,
            visitedAt: node.plannedStartAt,
            visitSummary: summaryByNode.get(node.id),
            createdFromTripResultId: result.id,
          } });
        }
        await this.linkAttachments(tx, {
          attachmentIds: body.attachmentIds, actorPersonId: input.actor.personId,
          entityType: TRIP_ENTITY, entityId: trip.id, relationType: TRIP_RESULT_ATTACHMENT_RELATION,
        });
        await tx.tripIdempotency.create({ data: {
          actorPersonId: input.actor.personId,
          actionCode: "TRIP_RESULT_SUBMIT",
          keyHash,
          payloadHash,
          tripId: trip.id,
          tripResultId: result.id,
        } });
        await writeTripAudit(tx, {
          ...input, actionCode: "TRIP_RESULT_SUBMITTED", entityType: "TRIP_RESULT", entityId: result.id,
          after: { tripId: trip.id, resultSummary: result.resultSummary, nextStep: result.nextStep, submittedByPersonId: result.submittedByPersonId, submittedAt: result.submittedAt.toISOString() },
        });
        await writeTripTransition(tx, {
          ...input, entityId: trip.id, fromState, toState: "COMPLETED", actionCode: "TRIP_RESULT_SUBMITTED",
          metadata: { tripResultId: result.id, enterpriseVisitCount: trip.nodes.filter(({ enterpriseId }) => enterpriseId).length },
        });
        const completed = await tx.trip.findUniqueOrThrow({ where: { id: trip.id }, include: tripDetailInclude });
        return this.present(completed, now);
      });
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const mapped = await this.existingResultForKey(input.actor.personId, keyHash);
      if (mapped) {
        if (mapped.payloadHash !== payloadHash || mapped.tripId !== input.tripId) {
          throw new TripError("TRIP_IDEMPOTENCY_CONFLICT", "同一 Idempotency-Key 不能用于不同结果内容");
        }
        return this.get({ actor: input.actor, tripId: input.tripId });
      }
      const result = await this.repository.prisma.tripResult.findUnique({ where: { tripId: input.tripId } });
      if (result) throw new TripError("TRIP_RESULT_ALREADY_EXISTS", "该共享行程已经提交过正式结果", { resultId: result.id });
      throw error;
    }
  }

  async updateResult(input: ServiceInput & { tripId: string; body: unknown }) {
    await authorizeActor({ actor: input.actor, action: "trip.result.submit" });
    const changes = tripResultUpdateSchema.parse(input.body);
    return this.repository.transaction(async (tx) => {
      const trip = await this.lockAndRequireTrip(tx, input.tripId);
      if (!trip.result) throw new TripError("TRIP_STATE_CONFLICT", "行程尚无正式结果");
      if (!(trip.createdByPersonId === input.actor.personId || trip.result.submittedByPersonId === input.actor.personId || adminActor(input.actor))) {
        throw new TripError("TRIP_FORBIDDEN", "只有创建人、原结果提交人或管理员可修改结果");
      }
      const before = trip.result;
      const result = await tx.tripResult.update({ where: { id: before.id }, data: {
        resultSummary: changes.resultSummary,
        nextStep: normalizeOptional(changes.nextStep),
      } });
      await this.linkAttachments(tx, {
        attachmentIds: changes.attachmentIds, actorPersonId: input.actor.personId,
        entityType: TRIP_ENTITY, entityId: trip.id, relationType: TRIP_RESULT_ATTACHMENT_RELATION,
      });
      await writeTripAudit(tx, {
        ...input, actionCode: "TRIP_RESULT_UPDATED", entityType: "TRIP_RESULT", entityId: result.id,
        before: { resultSummary: before.resultSummary, nextStep: before.nextStep, submittedByPersonId: before.submittedByPersonId, submittedAt: before.submittedAt.toISOString() },
        after: { resultSummary: result.resultSummary, nextStep: result.nextStep, submittedByPersonId: result.submittedByPersonId, submittedAt: result.submittedAt.toISOString() },
      });
      const updated = await tx.trip.findUniqueOrThrow({ where: { id: trip.id }, include: tripDetailInclude });
      return this.present(updated);
    });
  }

  async addVisitSupplement(input: ServiceInput & { visitId: string; body: unknown }) {
    await authorizeActor({ actor: input.actor, action: "visit.supplement" });
    const body = visitSupplementSchema.parse(input.body);
    return this.repository.transaction(async (tx) => {
      const visit = await this.lockAndRequireVisit(tx, input.visitId);
      if (!(visit.trip.createdByPersonId === input.actor.personId || visit.trip.participants.some(({ personId }) => personId === input.actor.personId) || adminActor(input.actor))) {
        throw new TripError("VISIT_FORBIDDEN", "只有行程参与人、创建人或管理员可补充走访");
      }
      const supplement = await tx.visitSupplement.create({ data: {
        visitId: visit.id, content: body.content, createdByPersonId: input.actor.personId,
      } });
      await this.linkAttachments(tx, {
        attachmentIds: body.attachmentIds, actorPersonId: input.actor.personId,
        entityType: ENTERPRISE_VISIT_ENTITY, entityId: visit.id, relationType: VISIT_ATTACHMENT_RELATION,
      });
      await writeTripAudit(tx, {
        ...input, actionCode: "VISIT_SUPPLEMENT_ADDED", entityType: "VISIT_SUPPLEMENT", entityId: supplement.id,
        after: { visitId: visit.id, content: supplement.content, createdByPersonId: supplement.createdByPersonId, createdAt: supplement.createdAt.toISOString() },
      });
      return supplement;
    });
  }

  async createDemandLead(input: ServiceInput & { visitId: string; body: unknown; idempotencyKey: string | null }) {
    await authorizeActor({ actor: input.actor, action: "visit.demand_lead.create" });
    if (!input.idempotencyKey) throw new TripError("TRIP_IDEMPOTENCY_REQUIRED", "从走访发现需求必须提供 Idempotency-Key");
    const key = idempotencyKeySchema.parse(input.idempotencyKey);
    const body = visitDemandLeadSchema.parse(input.body);
    const keyHash = sha256(`VISIT_DEMAND_LEAD:${key}`);
    const payloadHash = stableHash(body);
    return this.repository.transaction(async (tx) => {
      const visit = await this.lockAndRequireVisit(tx, input.visitId);
      const mapped = await tx.visitDemandLeadIdempotency.findUnique({ where: {
        actorPersonId_visitId_keyHash: { actorPersonId: input.actor.personId, visitId: visit.id, keyHash },
      }, include: { demandLead: true } });
      if (mapped) {
        if (mapped.payloadHash !== payloadHash) throw new TripError("TRIP_IDEMPOTENCY_CONFLICT", "同一 Idempotency-Key 不能用于不同需求内容");
        return mapped.demandLead;
      }
      if (!(hasActiveParticipant(visit.trip, input.actor.personId) || visit.trip.createdByPersonId === input.actor.personId || adminActor(input.actor))) {
        throw new TripError("VISIT_FORBIDDEN", "只有有效参与人、创建人或管理员可从走访发现需求");
      }
      let rawContactName: string | undefined;
      let rawContactPhone: string | undefined;
      if (body.contactId) {
        const contact = await tx.enterpriseContact.findUnique({ where: { id: body.contactId } });
        if (!contact || contact.enterpriseId !== visit.enterpriseId || contact.status !== "ACTIVE") {
          throw new TripError("VISIT_FORBIDDEN", "联系人不存在、已停用或不属于该企业");
        }
        rawContactName = contact.name;
        rawContactPhone = contact.phone;
      }
      const lead = await this.demandLeadService.createFromMemberVisitInTransaction(tx, {
        actor: input.actor,
        context: input.context,
        command: {
          responsibleAreaId: visit.enterprise.responsibleAreaId,
          enterpriseId: visit.enterpriseId,
          rawEnterpriseName: visit.enterprise.name,
          rawContactName,
          rawContactPhone,
          rawTitle: body.title,
          rawContent: body.note ? `${body.description}\n\n补充说明：${body.note}` : body.description,
          sourceChannel: "TRIP_VISIT",
          sourceAt: visit.visitedAt.toISOString(),
          tripId: visit.tripId,
          visitId: visit.id,
          attachmentIds: body.attachmentIds,
        },
      });
      await tx.visitDemandLeadIdempotency.create({ data: {
        actorPersonId: input.actor.personId, visitId: visit.id, keyHash, payloadHash, demandLeadId: lead.id,
      } });
      await writeTripAudit(tx, {
        ...input, actionCode: "VISIT_DEMAND_LEAD_CREATED", entityType: "ENTERPRISE_VISIT", entityId: visit.id,
        after: { demandLeadId: lead.id, businessNo: lead.businessNo, sourceType: lead.sourceType },
      });
      return lead;
    });
  }

  async correctVisit(input: ServiceInput & { visitId: string; body: unknown }) {
    await authorizeActor({ actor: input.actor, action: "visit.correct.admin", resource: {
      resourceType: "enterprise_visit", requiredScope: "GLOBAL_OPERATIONAL",
    } });
    const { changes, reason } = visitCorrectionSchema.parse(input.body);
    return this.repository.transaction(async (tx) => {
      const visit = await this.lockAndRequireVisit(tx, input.visitId);
      const updated = await tx.enterpriseVisit.update({ where: { id: visit.id }, data: {
        visitedAt: changes.visitedAt,
        visitSummary: normalizeOptional(changes.visitSummary),
      } });
      await writeTripAudit(tx, {
        ...input, actionCode: "VISIT_ADMIN_CORRECTED", entityType: "ENTERPRISE_VISIT", entityId: visit.id,
        before: { visitedAt: visit.visitedAt.toISOString(), visitSummary: visit.visitSummary },
        after: { visitedAt: updated.visitedAt.toISOString(), visitSummary: updated.visitSummary }, reason,
      });
      return updated;
    });
  }

  async correctTrip(input: ServiceInput & { tripId: string; body: unknown }) {
    await authorizeActor({ actor: input.actor, action: "trip.correct.admin", resource: {
      resourceType: "trip", requiredScope: "GLOBAL_OPERATIONAL",
    } });
    const { changes, reason } = tripCorrectionSchema.parse(input.body);
    return this.repository.transaction(async (tx) => {
      const trip = await this.lockAndRequireTrip(tx, input.tripId);
      if (trip.result && changes.nodes) {
        throw new TripError("TRIP_STATE_CONFLICT", "已完成行程的企业节点受下游走访和需求来源保护，不能通过上游纠错覆盖");
      }
      const updated = await this.applyTripUpdate(tx, trip, changes);
      await writeTripAudit(tx, {
        ...input, actionCode: "TRIP_ADMIN_CORRECTED", entityType: "TRIP", entityId: trip.id,
        before: tripSnapshot(trip), after: tripSnapshot(updated), reason,
      });
      await writeTripTransition(tx, {
        ...input, entityId: trip.id, fromState: deriveTripStatus(trip), toState: deriveTripStatus(updated),
        actionCode: "TRIP_ADMIN_CORRECTED", reason,
      });
      return this.present(updated);
    });
  }

  async get(input: ServiceInput & { tripId: string }) {
    await authorizeActor({ actor: input.actor, action: "trip.view" });
    const trip = await this.repository.getTrip(input.tripId);
    if (!trip) throw new TripError("TRIP_NOT_FOUND", "行程不存在");
    return this.present(trip);
  }

  async list(input: ServiceInput & { query: unknown; now?: Date }) {
    await authorizeActor({ actor: input.actor, action: "trip.view" });
    const query = tripListQuerySchema.parse(input.query);
    const now = input.now ?? new Date();
    const trips = await this.repository.prisma.trip.findMany({
      where: query.participant === "ME" ? { participants: { some: { personId: input.actor.personId, leftAt: null } } } : {},
      include: tripDetailInclude,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
    const filtered = trips.map((trip) => this.present(trip, now)).filter((trip) => !query.status || trip.status === query.status);
    const start = (query.page - 1) * query.pageSize;
    return { items: filtered.slice(start, start + query.pageSize), total: filtered.length, page: query.page, pageSize: query.pageSize };
  }

  async listToday(input: ServiceInput & { now?: Date }) {
    await authorizeActor({ actor: input.actor, action: "trip.view" });
    const now = input.now ?? new Date();
    const { start, end } = shanghaiDayBounds(now);
    const teamView = input.actor.capabilities.has("trip.create.team") || adminActor(input.actor);
    const trips = await this.repository.prisma.trip.findMany({
      where: {
        canceledAt: null,
        nodes: { some: { plannedStartAt: { gte: start, lte: end } } },
        ...(teamView ? {} : { participants: { some: { personId: input.actor.personId, leftAt: null } } }),
      },
      include: tripDetailInclude,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return trips.map((trip) => this.present(trip, now));
  }

  async listVisits(input: ServiceInput & { page?: number; pageSize?: number }) {
    await authorizeActor({ actor: input.actor, action: "visit.view" });
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 20));
    const [items, total] = await Promise.all([
      this.repository.prisma.enterpriseVisit.findMany({
        orderBy: [{ visitedAt: "desc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize,
        include: { enterprise: true, trip: true, supplements: true, demandLeads: true },
      }),
      this.repository.prisma.enterpriseVisit.count(),
    ]);
    return { items, total, page, pageSize };
  }

  async participantOptions(input: ServiceInput) {
    await authorizeActor({ actor: input.actor, action: "trip.view" });
    return this.repository.prisma.person.findMany({
      where: { personStatus: "ACTIVE", account: { is: { status: { not: "DISABLED" } } } },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, name: true },
      take: 200,
    });
  }

  async getVisit(input: ServiceInput & { visitId: string }) {
    await authorizeActor({ actor: input.actor, action: "visit.view" });
    const visit = await this.repository.prisma.enterpriseVisit.findUnique({
      where: { id: input.visitId },
      include: { enterprise: true, trip: true, tripNode: true, supplements: { include: { createdByPerson: true } }, demandLeads: true },
    });
    if (!visit) throw new TripError("VISIT_NOT_FOUND", "企业走访不存在");
    return visit;
  }

  private present<T extends { canceledAt: Date | null; result: unknown | null; nodes: readonly { plannedStartAt: Date; plannedEndAt: Date | null }[]; overallEndAt: Date | null }>(trip: T, now = new Date()) {
    return { ...trip, status: deriveTripStatus(trip, now), effectiveEndAt: effectiveTripEnd(trip) } as T & { status: TripStatus; effectiveEndAt: Date };
  }
}
