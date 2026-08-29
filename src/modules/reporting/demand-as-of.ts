import { shanghaiNaturalDayNumber } from "@/modules/demand/demand-responsibility";

export type TransitionFact = { toState: string; createdAt: Date; id?: string; actionCode?: string; metadataJson?: unknown };

export function statusAt(transitions: readonly TransitionFact[], asOf: Date): string | null {
  return transitions
    .filter((item) => item.createdAt <= asOf)
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || String(left.id ?? "").localeCompare(String(right.id ?? "")))
    .at(-1)?.toState ?? null;
}

export type OwnerAtFact = { personId: string; personName?: string; batchId: string; effectiveAt: Date; expiredAt: Date | null };

export function ownerAt(histories: readonly OwnerAtFact[], asOf: Date): OwnerAtFact | null {
  const active = histories.filter((item) => item.effectiveAt <= asOf && (item.expiredAt === null || item.expiredAt > asOf));
  return active.length === 1 ? active[0] : null;
}

function batchFromMetadata(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  for (const key of ["currentFollowBatchId", "batchId", "completionBatchId"]) {
    if (typeof item[key] === "string") return item[key];
  }
  return null;
}

export function resolveDemandBatchAt(input: {
  creationBatchId: string;
  ownerHistories: readonly OwnerAtFact[];
  transferFacts?: readonly { occurredAt: Date; metadataJson: unknown }[];
  asOf: Date;
}): string | null {
  const currentOwner = ownerAt(input.ownerHistories, input.asOf);
  if (currentOwner) return currentOwner.batchId;
  const transfer = [...(input.transferFacts ?? [])]
    .filter((item) => item.occurredAt <= input.asOf)
    .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime())
    .map((item) => batchFromMetadata(item.metadataJson))
    .filter((item): item is string => Boolean(item))
    .at(-1);
  if (transfer) return transfer;
  const anyCrossBatchEvidence = input.ownerHistories.some((item) => item.batchId !== input.creationBatchId && item.effectiveAt <= input.asOf);
  return anyCrossBatchEvidence ? null : input.creationBatchId;
}

export function getDemandProgressFreshnessAt(input: {
  status: string | null;
  progresses: readonly { createdAt: Date }[];
  responsibilityBaselines: readonly Date[];
  asOf: Date;
}) {
  const latestProgressAt = input.progresses.filter((item) => item.createdAt <= input.asOf).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).at(-1)?.createdAt ?? null;
  const responsibilityStartedAt = [...input.responsibilityBaselines].filter((item) => item <= input.asOf).sort((a, b) => a.getTime() - b.getTime()).at(-1) ?? null;
  const freshnessBaseAt = latestProgressAt ?? responsibilityStartedAt;
  const elapsedNaturalDays = freshnessBaseAt ? shanghaiNaturalDayNumber(input.asOf) - shanghaiNaturalDayNumber(freshnessBaseAt) : 0;
  return { latestProgressAt, responsibilityStartedAt, freshnessBaseAt, stale: input.status === "IN_PROGRESS" && freshnessBaseAt !== null && elapsedNaturalDays > 30 };
}

export function outcomePlanAt(input: {
  trackingMode: string;
  decidedAt: Date;
  firstTrackingDate: Date | null;
  approvedRounds: readonly { reviewedAt: Date | null; nextTrackingDate: Date | null; endTracking: boolean; roundNo: number }[];
  asOf: Date;
}) {
  if (input.decidedAt > input.asOf || input.trackingMode !== "TRACKING" || !input.firstTrackingDate) return { status: "NOT_TRACKED" as const, nextDueDate: null };
  const latest = input.approvedRounds
    .filter((round) => round.reviewedAt !== null && round.reviewedAt <= input.asOf)
    .sort((a, b) => a.reviewedAt!.getTime() - b.reviewedAt!.getTime() || a.roundNo - b.roundNo)
    .at(-1);
  if (latest?.endTracking) return { status: "ENDED" as const, nextDueDate: null };
  return { status: latest ? "IN_PROGRESS" as const : "PENDING" as const, nextDueDate: latest?.nextTrackingDate ?? input.firstTrackingDate };
}
