export type EffectiveWhere = {
  effectiveAt: { lte: Date };
  OR: [{ expiredAt: null }, { expiredAt: { gt: Date } }];
};

export function effectiveAt(now: Date): EffectiveWhere {
  return {
    effectiveAt: { lte: now },
    OR: [{ expiredAt: null }, { expiredAt: { gt: now } }],
  };
}
export function dateRangeContains(start: Date, end: Date | null, now: Date): boolean {
  return start <= now && (end === null || end > now);
}
