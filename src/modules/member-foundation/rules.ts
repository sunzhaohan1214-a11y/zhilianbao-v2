export type MembershipWindow = { status: string; startDate: Date; endDate: Date | null; batchId: string };
export type RoleWindow = { roleCode: string; effectiveAt: Date; expiredAt: Date | null };

export function isEffectiveWindow(start: Date, end: Date | null, now: Date): boolean {
  return start <= now && (end === null || end > now);
}

export function classifyMember(input: {
  memberships: readonly MembershipWindow[];
  roles: readonly RoleWindow[];
  currentBatchId: string | null;
  hasAccount: boolean;
  now: Date;
}): "current" | "alumni" | null {
  const activeRole = (code: string) => input.roles.some((role) => role.roleCode === code && isEffectiveWindow(role.effectiveAt, role.expiredAt, input.now));
  const currentMembership = input.currentBatchId !== null && input.memberships.some((membership) =>
    membership.batchId === input.currentBatchId
    && membership.status === "ACTIVE"
    && isEffectiveWindow(membership.startDate, membership.endDate, input.now));
  if (currentMembership && activeRole("MEMBER_CURRENT")) return "current";
  const historicalMembership = input.memberships.some((membership) =>
    membership.startDate <= input.now && (
      membership.batchId !== input.currentBatchId
      || membership.status !== "ACTIVE"
      || membership.endDate !== null && membership.endDate <= input.now
    ));
  if ((input.hasAccount && activeRole("MEMBER_ALUMNI_PLATFORM")) || historicalMembership) return "alumni";
  return null;
}

export function assertMembershipLimit(currentCount: number): void {
  if (currentCount >= 3) throw new Error("MEMBERSHIP_LIMIT_EXCEEDED");
}

export function isCurrentAppointment(input: { effectiveAt: Date; expiredAt: Date | null }, now: Date): boolean {
  return isEffectiveWindow(input.effectiveAt, input.expiredAt, now);
}

export function roleLabel(roleCode: string): string {
  if (roleCode === "GROUP_LEADER") return "团长";
  if (roleCode === "MINISTER") return "部长";
  return roleCode;
}

export function planBatchTransition(input: { targetStatus: "PLANNED" | "ACTIVE" | "CLOSED"; targetIsCurrent: boolean; currentBatchId: string | null; targetBatchId: string }) {
  if (input.targetStatus === "CLOSED") throw new Error("BATCH_CLOSED_CANNOT_ACTIVATE");
  if (input.targetIsCurrent && input.targetStatus === "ACTIVE") return { changed: false, previousCurrentBatchId: input.currentBatchId };
  return { changed: true, previousCurrentBatchId: input.currentBatchId, nextCurrentBatchId: input.targetBatchId };
}
