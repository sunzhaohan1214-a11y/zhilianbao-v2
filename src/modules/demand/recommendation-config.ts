const DEFAULT_CLAIM_PERIOD_DAYS = 30;

export function getDemandClaimPeriodDays(env: NodeJS.ProcessEnv = process.env): number {
  const value = env.DEMAND_CLAIM_PERIOD_DAYS;
  if (!value) return DEFAULT_CLAIM_PERIOD_DAYS;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 365 ? parsed : DEFAULT_CLAIM_PERIOD_DAYS;
}

export function getClaimDeadline(
  demand: { firstPublishedAt: Date | null },
  claimPeriodDays = getDemandClaimPeriodDays(),
): Date | null {
  if (!demand.firstPublishedAt) return null;
  return new Date(demand.firstPublishedAt.getTime() + claimPeriodDays * 24 * 60 * 60 * 1_000);
}

export function isAlumniFallbackEligible(input: {
  demand: { status: string; firstPublishedAt: Date | null; currentOwnerPersonId: string | null };
  latestCurrentRun?: { status: string; itemCount: number } | null;
  now?: Date;
  claimPeriodDays?: number;
}): boolean {
  const now = input.now ?? new Date();
  if (input.demand.status !== "PENDING_CLAIM" || input.demand.currentOwnerPersonId !== null) return false;
  const deadline = getClaimDeadline(input.demand, input.claimPeriodDays);
  const zeroCurrentResult = Boolean(
    input.latestCurrentRun
    && ["SUCCEEDED", "FALLBACK_SUCCEEDED"].includes(input.latestCurrentRun.status)
    && input.latestCurrentRun.itemCount === 0,
  );
  return zeroCurrentResult || Boolean(deadline && now >= deadline);
}

