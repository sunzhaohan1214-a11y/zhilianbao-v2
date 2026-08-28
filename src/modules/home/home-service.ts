import type { PrismaClient } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { AnnouncementService } from "@/modules/announcement";
import {
  demandProgressStaleCutoff,
  isDemandProgressStale,
  shanghaiNaturalDayNumber,
} from "@/modules/demand/demand-responsibility";
import { NotificationService } from "@/modules/notification";
import { authorizeActor } from "@/modules/permissions/authorization";
import type { PermissionActor } from "@/modules/permissions/types";
import { PresenceService } from "@/modules/presence";
import { effectiveTripEnd } from "@/modules/trip/status";
import { TripService } from "@/modules/trip/trip-service";
import { HOME_TODO_LABELS, resolveHomeTodoPriority, sortHomeTodos } from "./home-todo-priority-resolver";
import type { HomeDemand, HomeOverview, HomeRoleLabel, HomeTeamOverview, HomeTodo } from "./types";

const TODO_SCAN_LIMIT = 50;

export function homeRoleLabels(actor: PermissionActor): HomeRoleLabel[] {
  return [
    ...(actor.effectiveRoles.includes("GROUP_LEADER") ? ["团长" as const] : []),
    ...(actor.effectiveRoles.includes("MINISTER") ? ["部长" as const] : []),
  ];
}

function isAdministrator(actor: PermissionActor) {
  return actor.effectiveRoles.includes("ADMIN") || actor.effectiveRoles.includes("SUPER_ADMIN");
}

function isResponsibleTownship(actor: PermissionActor, areaId: string) {
  return actor.effectiveRoles.includes("TOWNSHIP_STAFF") && actor.townshipAreaIds.includes(areaId);
}

function dateIsDue(value: Date | null, now: Date) {
  return value !== null && shanghaiNaturalDayNumber(value) <= shanghaiNaturalDayNumber(now);
}

export class HomeService {
  private readonly announcements: AnnouncementService;
  private readonly notifications: NotificationService;
  private readonly presence: PresenceService;
  private readonly trips: TripService;

  constructor(private readonly prisma: PrismaClient = getPrismaClient()) {
    this.announcements = new AnnouncementService();
    this.notifications = new NotificationService();
    this.presence = new PresenceService();
    this.trips = new TripService();
  }

  async overview(input: { actor: PermissionActor; now?: Date }): Promise<HomeOverview> {
    const now = input.now ?? new Date();
    const labels = homeRoleLabels(input.actor);
    const [person, counts, announcement, teamOverview, presence, trips, todos, latestDemands] = await Promise.all([
      this.prisma.person.findUniqueOrThrow({ where: { id: input.actor.personId }, select: { name: true } }),
      this.notifications.getCounts(input.actor),
      this.announcements.getTopVisibleAnnouncement(input.actor),
      labels.length > 0 ? this.teamOverview({ actor: input.actor, now }) : Promise.resolve(null),
      this.presence.currentSummary({ actor: input.actor, now, limit: 5 }),
      this.trips.listTodaySummary({ actor: input.actor, now, limit: 3 }),
      this.homeTodos(input.actor, now),
      this.latestDemands(input.actor),
    ]);

    const recipientState = announcement?.currentVersion?.recipientStates[0];
    return {
      header: { displayName: person.name, unreadMessageCount: counts.unreadMessageCount, roleLabels: labels },
      announcement: announcement?.currentVersion ? {
        id: announcement.id,
        title: announcement.currentVersion.title,
        isImportant: announcement.currentVersion.isImportant,
        needConfirm: announcement.currentVersion.needConfirm,
        pendingConfirm: announcement.currentVersion.needConfirm && !recipientState?.confirmedAt,
        publishedAt: announcement.publishedAt,
      } : null,
      teamOverview,
      presence: {
        total: presence.total,
        currentCount: presence.currentCount,
        alumniCount: presence.alumniCount,
        remainingCount: Math.max(0, presence.total - presence.items.length),
        people: presence.items.map(({ person: { id, name, memberType } }) => ({ id, name, memberType })),
      },
      trips,
      todos,
      latestDemands,
    };
  }

  async teamOverview(input: { actor: PermissionActor; now?: Date }): Promise<HomeTeamOverview> {
    await authorizeActor({ actor: input.actor, action: "team.overview.view" });
    const labels = homeRoleLabels(input.actor);
    if (labels.length === 0) throw new Error("TEAM_OVERVIEW_ROLE_REQUIRED");
    const now = input.now ?? new Date();
    const [groups, stale] = await Promise.all([
      this.prisma.demand.groupBy({
        by: ["status"],
        where: { status: { in: ["PENDING_CLAIM", "IN_PROGRESS", "PENDING_CLOSE_REVIEW"] } },
        _count: { _all: true },
      }),
      this.getStaleDemandCountAt(now),
    ]);
    const count = new Map(groups.map((group) => [group.status, group._count._all]));
    return {
      roleLabels: labels,
      pendingClaim: count.get("PENDING_CLAIM") ?? 0,
      inProgress: count.get("IN_PROGRESS") ?? 0,
      stale,
      pendingCloseReview: count.get("PENDING_CLOSE_REVIEW") ?? 0,
    };
  }

  async getStaleDemandCountAt(now = new Date()): Promise<number> {
    const cutoff = staleCutoffAt(now);
    const rows = await this.prisma.$queryRaw<Array<{ staleCount: bigint }>>`
      SELECT COUNT(DISTINCT d.id) AS staleCount
      FROM demands d
      LEFT JOIN (
        SELECT demand_id, MAX(created_at) AS latest_progress_at
        FROM demand_progresses
        GROUP BY demand_id
      ) p ON p.demand_id = d.id
      LEFT JOIN demand_owner_histories owner
        ON owner.demand_id = d.id AND owner.active_key = 1 AND owner.expired_at IS NULL
      LEFT JOIN demand_township_handlers handler
        ON handler.demand_id = d.id AND handler.active_key = 1 AND handler.expired_at IS NULL
      LEFT JOIN (
        SELECT demand_id, COUNT(*) AS active_helper_count
        FROM demand_alumni_helpers
        WHERE active_key = 1 AND status = 'ACTIVE' AND expired_at IS NULL
        GROUP BY demand_id
      ) helper ON helper.demand_id = d.id
      WHERE d.status = 'IN_PROGRESS'
        AND (
          (d.current_owner_person_id IS NOT NULL
            AND owner.person_id = d.current_owner_person_id
            AND handler.id IS NULL
            AND COALESCE(helper.active_helper_count, 0) = 0)
          OR
          (d.current_owner_person_id IS NULL
            AND owner.id IS NULL
            AND handler.id IS NOT NULL
            AND COALESCE(helper.active_helper_count, 0) > 0)
        )
        AND COALESCE(p.latest_progress_at, owner.effective_at, handler.effective_at) < ${cutoff}
    `;
    return Number(rows[0]?.staleCount ?? 0);
  }

  private async latestDemands(actor: PermissionActor): Promise<{ items: HomeDemand[]; remainingCount: number }> {
    await authorizeActor({ actor, action: "demand.view" });
    const where = { status: "PENDING_CLAIM" as const, currentOwnerPersonId: null, firstPublishedAt: { not: null } };
    const recommendedWhere = {
      ...where,
      recommendationRuns: { some: {
        stage: "CURRENT" as const,
        currentKey: 1,
        items: { some: {
          personId: actor.personId,
          OR: [{ responseStatus: null }, { responseStatus: { not: "DECLINE" as const } }],
        } },
      } },
    };
    const select = {
      id: true, businessNo: true, title: true, urgency: true, firstPublishedAt: true,
      enterprise: { select: { name: true } },
      responsibleArea: { select: { name: true } },
    } as const;
    const [total, recommended] = await Promise.all([
      this.prisma.demand.count({ where }),
      this.prisma.demand.findMany({
        where: recommendedWhere,
        orderBy: [{ firstPublishedAt: "desc" }, { id: "asc" }],
        take: 3,
        select,
      }),
    ]);
    const regular = recommended.length >= 3 ? [] : await this.prisma.demand.findMany({
      where: { ...where, id: { notIn: recommended.map(({ id }) => id) } },
      orderBy: [{ firstPublishedAt: "desc" }, { id: "asc" }],
      take: 3 - recommended.length,
      select,
    });
    const recommendedIds = new Set(recommended.map(({ id }) => id));
    const items = [...recommended, ...regular].map((demand): HomeDemand => {
      if (!demand.firstPublishedAt) throw new Error("HOME_DEMAND_PUBLISHED_AT_REQUIRED");
      const isRecommended = recommendedIds.has(demand.id);
      return {
        id: demand.id,
        businessNo: demand.businessNo,
        title: demand.title,
        enterpriseName: demand.enterprise.name,
        responsibleAreaName: demand.responsibleArea.name,
        status: "PENDING_CLAIM",
        attentionLabel: isRecommended ? "为你推荐" : demand.urgency === "URGENT" ? "紧急" : null,
        recommended: isRecommended,
        firstPublishedAt: demand.firstPublishedAt,
      };
    });
    return { items, remainingCount: Math.max(0, total - items.length) };
  }

  private async homeTodos(actor: PermissionActor, now: Date): Promise<HomeTodo[]> {
    await authorizeActor({ actor, action: "todo.view.self" });
    const todos = await this.prisma.todo.findMany({
      where: { personId: actor.personId, status: "OPEN" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: TODO_SCAN_LIMIT,
    });
    if (todos.length === 0) return [];

    const ids = (aggregateType: string) => [...new Set(todos.filter((todo) => todo.aggregateType === aggregateType).map((todo) => todo.aggregateId))];
    const demandIds = ids("DEMAND");
    const helpIds = ids("HELP_REQUEST");
    const tripIds = ids("TRIP");
    const announcementIds = ids("ANNOUNCEMENT");
    const reimbursementIds = ids("REIMBURSEMENT");
    const [demands, helps, trips, announcements, reimbursements, appointments] = await Promise.all([
      this.prisma.demand.findMany({ where: { id: { in: demandIds } }, select: {
        id: true, status: true, urgency: true, responsibleAreaId: true, currentOwnerPersonId: true,
        progresses: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { createdAt: true } },
        ownerHistories: { where: { activeKey: 1, expiredAt: null }, take: 2, select: { personId: true, effectiveAt: true } },
        townshipHandlers: { where: { activeKey: 1, expiredAt: null }, take: 2, select: { personId: true, effectiveAt: true } },
        alumniHelpers: { where: { activeKey: 1, status: "ACTIVE", expiredAt: null }, take: 1, select: { id: true } },
        collaborationRequests: { where: { status: "PENDING", pendingKey: 1 }, select: { id: true, personId: true, requestType: true } },
        recommendationRuns: { where: { currentKey: 1 }, select: { stage: true, items: { where: { personId: actor.personId }, select: { responseStatus: true } } } },
        ownerExitRequests: { where: { status: "PENDING", activeKey: 1 }, select: { id: true } },
        outcomePlan: { select: { status: true, nextTrackingDate: true, rounds: { where: { activeKey: 1 }, take: 1, select: { reviewStatus: true, trackingDate: true } } } },
      } }),
      this.prisma.helpRequest.findMany({ where: { id: { in: helpIds } }, select: { id: true, status: true, urgency: true, currentOwnerPersonId: true, transferredOrganizationId: true, expectedCompleteAt: true } }),
      this.prisma.trip.findMany({ where: { id: { in: tripIds } }, select: { id: true, canceledAt: true, overallEndAt: true, result: { select: { id: true } }, nodes: { select: { plannedStartAt: true, plannedEndAt: true } }, participants: { where: { personId: actor.personId, leftAt: null }, select: { id: true } } } }),
      this.prisma.announcement.findMany({ where: { id: { in: announcementIds } }, select: { id: true, status: true, currentVersion: { select: { recipientStates: { where: { personId: actor.personId }, select: { revokedAt: true, confirmedAt: true } } } } } }),
      this.prisma.reimbursement.findMany({ where: { id: { in: reimbursementIds } }, select: { id: true, status: true, applicantPersonId: true } }),
      this.prisma.appointment.findMany({ where: { personId: actor.personId, effectiveAt: { lte: now }, OR: [{ expiredAt: null }, { expiredAt: { gt: now } }], organization: { status: "ACTIVE" } }, select: { organizationId: true } }),
    ]);
    const demandById = new Map(demands.map((item) => [item.id, item]));
    const helpById = new Map(helps.map((item) => [item.id, item]));
    const tripById = new Map(trips.map((item) => [item.id, item]));
    const announcementById = new Map(announcements.map((item) => [item.id, item]));
    const reimbursementById = new Map(reimbursements.map((item) => [item.id, item]));
    const organizationIds = new Set(appointments.map(({ organizationId }) => organizationId));

    const actionable = todos.flatMap((todo) => {
      const label = HOME_TODO_LABELS[todo.todoType];
      if (!label) return [];
      let valid = false;
      let dueAt: Date | null = null;
      let demandUrgency;
      let helpUrgency;
      const demand = demandById.get(todo.aggregateId);
      const help = helpById.get(todo.aggregateId);
      const trip = tripById.get(todo.aggregateId);
      const announcement = announcementById.get(todo.aggregateId);
      const reimbursement = reimbursementById.get(todo.aggregateId);

      if (demand) {
        demandUrgency = demand.urgency;
        const ownerShape = demand.currentOwnerPersonId !== null
          && demand.ownerHistories.length === 1
          && demand.ownerHistories[0]?.personId === demand.currentOwnerPersonId
          && demand.townshipHandlers.length === 0
          && demand.alumniHelpers.length === 0;
        const alumniShape = demand.currentOwnerPersonId === null
          && demand.ownerHistories.length === 0
          && demand.townshipHandlers.length === 1
          && demand.alumniHelpers.length > 0;
        const responsibilityPersonId = ownerShape
          ? demand.currentOwnerPersonId
          : alumniShape ? demand.townshipHandlers[0]!.personId : null;
        const responsibilityStartedAt = ownerShape
          ? demand.ownerHistories[0]!.effectiveAt
          : alumniShape ? demand.townshipHandlers[0]!.effectiveAt : null;
        const freshnessBase = demand.progresses[0]?.createdAt ?? responsibilityStartedAt;
        const stale = responsibilityPersonId !== null
          && isDemandProgressStale({ status: demand.status, freshnessBaseAt: freshnessBase, now });
        const pendingRequest = demand.collaborationRequests.find(({ id }) => id === todo.eventKey);
        const outcomeRound = demand.outcomePlan?.rounds[0];
        if (todo.todoType === "DEMAND_REVIEW") valid = demand.status === "PENDING_REVIEW" && isAdministrator(actor);
        else if (todo.todoType === "DEMAND_REVISE") valid = demand.status === "RETURNED" && isResponsibleTownship(actor, demand.responsibleAreaId);
        else if (todo.todoType === "COLLABORATION_REVIEW") valid = demand.status === "IN_PROGRESS" && demand.currentOwnerPersonId === actor.personId && pendingRequest?.requestType === "APPLY";
        else if (todo.todoType === "COLLABORATION_INVITE_RESPONSE") valid = demand.status === "IN_PROGRESS" && pendingRequest?.requestType === "INVITE" && pendingRequest.personId === actor.personId;
        else if (todo.todoType === "DEMAND_UPDATE_STALE") valid = stale && responsibilityPersonId === actor.personId;
        else if (todo.todoType === "DEMAND_CONTINUE") valid = demand.status === "IN_PROGRESS" && responsibilityPersonId === actor.personId;
        else if (todo.todoType === "DEMAND_CLOSE_REVIEW") valid = demand.status === "PENDING_CLOSE_REVIEW" && isAdministrator(actor);
        else if (todo.todoType === "DEMAND_OWNER_EXIT_REVIEW") valid = demand.status === "IN_PROGRESS" && demand.ownerExitRequests.length === 1 && isAdministrator(actor);
        else if (todo.todoType === "DEMAND_ALUMNI_RESPONSE") valid = demand.status === "PENDING_CLAIM" && demand.recommendationRuns.some((run) => run.stage === "ALUMNI" && run.items.some(({ responseStatus }) => responseStatus === null));
        else if (todo.todoType === "OUTCOME_FILL") {
          dueAt = demand.outcomePlan?.nextTrackingDate ?? null;
          valid = demand.status === "COMPLETED" && Boolean(demand.outcomePlan) && ["PENDING", "IN_PROGRESS"].includes(demand.outcomePlan!.status) && dateIsDue(dueAt, now) && isResponsibleTownship(actor, demand.responsibleAreaId);
        } else if (todo.todoType === "OUTCOME_REVIEW") valid = demand.status === "COMPLETED" && outcomeRound?.reviewStatus === "PENDING_REVIEW" && isAdministrator(actor);
        else if (todo.todoType === "OUTCOME_REVISE") valid = demand.status === "COMPLETED" && outcomeRound?.reviewStatus === "RETURNED" && isResponsibleTownship(actor, demand.responsibleAreaId);
      } else if (help) {
        helpUrgency = help.urgency;
        dueAt = help.expectedCompleteAt;
        if (todo.todoType === "HELP_CLAIM") valid = help.status === "PENDING" && help.currentOwnerPersonId === null && help.transferredOrganizationId !== null && organizationIds.has(help.transferredOrganizationId) && actor.capabilities.has("help.claim");
        else if (todo.todoType === "HELP_PROCESS") valid = help.status === "IN_PROGRESS" && help.currentOwnerPersonId === actor.personId;
      } else if (trip && todo.todoType === "TRIP_RESULT") {
        dueAt = trip.nodes.length > 0 ? effectiveTripEnd(trip) : null;
        valid = trip.canceledAt === null && trip.result === null && trip.participants.length === 1 && dueAt !== null && now > dueAt;
      } else if (announcement && todo.todoType === "ANNOUNCEMENT_CONFIRM") {
        const state = announcement.currentVersion?.recipientStates[0];
        valid = announcement.status === "PUBLISHED" && Boolean(state) && state?.revokedAt === null && state.confirmedAt === null;
      } else if (reimbursement) {
        if (todo.todoType === "REIMBURSEMENT_REVIEW") valid = reimbursement.status === "PENDING_ONLINE_REVIEW" && actor.specialPermissions.has("reimbursement.manage");
        else if (todo.todoType === "REIMBURSEMENT_REVISE") valid = reimbursement.status === "RETURNED" && reimbursement.applicantPersonId === actor.personId;
        else if (todo.todoType === "REIMBURSEMENT_SUBMIT_FINANCE") valid = reimbursement.status === "PAPER_RECEIVED" && actor.specialPermissions.has("reimbursement.manage");
      }
      if (!valid) return [];
      return [resolveHomeTodoPriority({ id: todo.id, type: todo.todoType, label, module: todo.module, actionUrl: todo.actionUrl, dueAt, createdAt: todo.createdAt, demandUrgency, helpUrgency })];
    });
    return sortHomeTodos(actionable).slice(0, 3);
  }
}

export function staleCutoffAt(now: Date): Date {
  return demandProgressStaleCutoff(now);
}
