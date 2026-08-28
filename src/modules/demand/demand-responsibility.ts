import type { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { DemandError } from "./errors";

export type CurrentDemandResponsibility =
  | { mode: "CURRENT_OWNER"; ownerPersonId: string }
  | { mode: "ALUMNI_TOWNSHIP"; townshipHandlerPersonId: string; alumniHelperPersonIds: string[] };

export type CurrentDemandResponsibilityDetails =
  | { mode: "CURRENT_OWNER"; ownerPersonId: string; ownerHistoryId: string; responsibilityStartedAt: Date }
  | {
      mode: "ALUMNI_TOWNSHIP";
      townshipHandlerPersonId: string;
      townshipHandlerId: string;
      responsibilityStartedAt: Date;
      alumniHelpers: { personId: string; helperKind: "PLATFORM" | "HISTORICAL" }[];
    };

function invalid(): never {
  throw new DemandError(
    "DEMAND_PROGRESS_RESPONSIBILITY_INVALID",
    "需求当前责任关系不完整或互相矛盾，已拒绝继续操作",
  );
}

export async function getCurrentDemandResponsibilityDetailsInTransaction(
  tx: Prisma.TransactionClient,
  demandId: string,
): Promise<CurrentDemandResponsibilityDetails | null> {
  const demand = await tx.demand.findUnique({
    where: { id: demandId },
    select: {
      currentOwnerPersonId: true,
      ownerHistories: {
        where: { activeKey: 1, expiredAt: null },
        select: { id: true, personId: true, effectiveAt: true },
        take: 2,
      },
      townshipHandlers: {
        where: { activeKey: 1, expiredAt: null },
        select: { id: true, personId: true, effectiveAt: true },
        take: 2,
      },
      alumniHelpers: {
        where: { activeKey: 1, status: "ACTIVE", expiredAt: null },
        select: { personId: true, helperKind: true },
        orderBy: [{ effectiveAt: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!demand) throw new DemandError("DEMAND_NOT_FOUND", "需求不存在");

  const hasOwnerShape = demand.currentOwnerPersonId !== null || demand.ownerHistories.length > 0;
  const hasAlumniShape = demand.townshipHandlers.length > 0 || demand.alumniHelpers.length > 0;
  if (!hasOwnerShape && !hasAlumniShape) return null;
  if (hasOwnerShape && hasAlumniShape) invalid();

  if (demand.currentOwnerPersonId !== null) {
    const owner = demand.ownerHistories[0];
    if (demand.ownerHistories.length !== 1 || !owner || owner.personId !== demand.currentOwnerPersonId) invalid();
    return {
      mode: "CURRENT_OWNER",
      ownerPersonId: owner.personId,
      ownerHistoryId: owner.id,
      responsibilityStartedAt: owner.effectiveAt,
    };
  }
  if (demand.ownerHistories.length > 0) invalid();

  const handler = demand.townshipHandlers[0];
  if (demand.townshipHandlers.length !== 1 || !handler || demand.alumniHelpers.length === 0) invalid();
  return {
    mode: "ALUMNI_TOWNSHIP",
    townshipHandlerPersonId: handler.personId,
    townshipHandlerId: handler.id,
    responsibilityStartedAt: handler.effectiveAt,
    alumniHelpers: demand.alumniHelpers,
  };
}

export async function getCurrentDemandResponsibilityInTransaction(
  tx: Prisma.TransactionClient,
  demandId: string,
): Promise<CurrentDemandResponsibility | null> {
  const responsibility = await getCurrentDemandResponsibilityDetailsInTransaction(tx, demandId);
  if (!responsibility) return null;
  return responsibility.mode === "CURRENT_OWNER"
    ? { mode: responsibility.mode, ownerPersonId: responsibility.ownerPersonId }
    : {
        mode: responsibility.mode,
        townshipHandlerPersonId: responsibility.townshipHandlerPersonId,
        alumniHelperPersonIds: responsibility.alumniHelpers.map(({ personId }) => personId),
      };
}

export function getCurrentDemandResponsibility(demandId: string): Promise<CurrentDemandResponsibility | null> {
  return getPrismaClient().$transaction((tx) => getCurrentDemandResponsibilityInTransaction(tx, demandId));
}

const DAY_MS = 86_400_000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

export function shanghaiNaturalDayNumber(value: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value);
  return Math.floor(Date.UTC(part("year"), part("month") - 1, part("day")) / DAY_MS);
}

export function shanghaiDateFromNaturalDayNumber(dayNumber: number): Date {
  return new Date(dayNumber * DAY_MS - SHANGHAI_OFFSET_MS);
}

export function demandProgressStaleCutoff(now: Date): Date {
  return shanghaiDateFromNaturalDayNumber(shanghaiNaturalDayNumber(now) - 30);
}

export function isDemandProgressStale(input: { status: string; freshnessBaseAt: Date | null; now: Date }): boolean {
  return input.status === "IN_PROGRESS"
    && input.freshnessBaseAt !== null
    && input.freshnessBaseAt < demandProgressStaleCutoff(input.now);
}

export async function getDemandProgressFreshnessInTransaction(
  tx: Prisma.TransactionClient,
  demandId: string,
  now = new Date(),
) {
  const demand = await tx.demand.findUnique({ where: { id: demandId }, select: { status: true } });
  if (!demand) throw new DemandError("DEMAND_NOT_FOUND", "需求不存在");
  const latest = await tx.demandProgress.findFirst({
    where: { demandId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { createdAt: true },
  });
  const responsibility = await getCurrentDemandResponsibilityDetailsInTransaction(tx, demandId);
  if (demand.status === "IN_PROGRESS" && !responsibility) invalid();
  const responsibilityStartedAt = responsibility?.responsibilityStartedAt ?? null;
  const freshnessBaseAt = latest?.createdAt ?? responsibilityStartedAt;
  const stale = isDemandProgressStale({ status: demand.status, freshnessBaseAt, now });
  return {
    lastProgressAt: latest?.createdAt ?? null,
    responsibilityStartedAt,
    freshnessBaseAt,
    stale,
    staleSince: stale && freshnessBaseAt
      ? shanghaiDateFromNaturalDayNumber(shanghaiNaturalDayNumber(freshnessBaseAt) + 31)
      : null,
  };
}

export function getDemandProgressFreshness(demandId: string, now = new Date()) {
  return getPrismaClient().$transaction((tx) => getDemandProgressFreshnessInTransaction(tx, demandId, now));
}
