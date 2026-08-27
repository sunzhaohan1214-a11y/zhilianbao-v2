export type MemberMapKind = "current" | "alumni";

export type MapMembershipCandidate = {
  batchId: string;
  status: string;
  startDate: Date;
  endDate: Date | null;
};

export function selectMemberMapMembership<T extends MapMembershipCandidate>(
  kind: MemberMapKind,
  memberships: T[],
  currentBatchId: string | null,
  now: Date,
): T | undefined {
  if (kind === "current") {
    return memberships.find((item) =>
      item.batchId === currentBatchId
      && item.status === "ACTIVE"
      && item.startDate <= now
      && (!item.endDate || item.endDate > now));
  }

  return memberships.find((item) =>
    item.startDate <= now
    && (
      item.batchId !== currentBatchId
      || item.status !== "ACTIVE"
      || (!!item.endDate && item.endDate <= now)
    ));
}

export function matchesMemberMapFilters(input: {
  personName: string;
  organization: { id: string; name: string } | null;
  professionalDirection: string | null;
  keyword?: string;
  dispatchOrganizationId?: string;
}): boolean {
  if (input.keyword) {
    const haystack = `${input.personName} ${input.organization?.name ?? ""} ${input.professionalDirection ?? ""}`.toLowerCase();
    if (!haystack.includes(input.keyword.toLowerCase())) return false;
  }
  if (input.dispatchOrganizationId && input.organization?.id !== input.dispatchOrganizationId) return false;
  return true;
}
