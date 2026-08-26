import type { AccountStatus, RoleCode } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { hashSessionToken } from "./session-token";

export type CurrentSession = {
  sessionId: string;
  accountId: string;
  personId: string;
  name: string;
  phone: string;
  accountStatus: AccountStatus;
  forcePasswordChange: boolean;
  confidentialityConfirmedAt: Date | null;
  permissionVersion: bigint;
  deviceId: string;
  roles: RoleCode[];
};

export async function getCurrentSessionByToken(rawToken: string | undefined): Promise<CurrentSession | null> {
  if (!rawToken) return null;
  const prisma = getPrismaClient();
  const now = new Date();
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(rawToken) },
    include: { account: { include: { person: true } } },
  });
  if (!session) return null;
  const invalid = Boolean(session.revokedAt)
    || session.expiresAt <= now
    || !["UNACTIVATED", "NORMAL"].includes(session.account.status)
    || (session.account.status === "NORMAL" && !session.account.confidentialityConfirmedAt)
    || session.permissionVersion !== session.account.permissionVersion;
  if (invalid) {
    if (!session.revokedAt) await prisma.session.update({ where: { id: session.id }, data: { revokedAt: now } });
    return null;
  }
  const assignments = await prisma.roleAssignment.findMany({
    where: {
      personId: session.account.personId,
      effectiveAt: { lte: now },
      OR: [{ expiredAt: null }, { expiredAt: { gt: now } }],
    },
    select: { roleCode: true },
  });
  return {
    sessionId: session.id,
    accountId: session.accountId,
    personId: session.account.personId,
    name: session.account.person.name,
    phone: session.account.phone,
    accountStatus: session.account.status,
    forcePasswordChange: session.account.forcePasswordChange,
    confidentialityConfirmedAt: session.account.confidentialityConfirmedAt,
    permissionVersion: session.account.permissionVersion,
    deviceId: session.deviceId,
    roles: assignments.map(({ roleCode }) => roleCode),
  };
}

export function canAccessBusiness(session: CurrentSession): boolean {
  return session.accountStatus === "NORMAL"
    && !session.forcePasswordChange
    && Boolean(session.confidentialityConfirmedAt);
}
