import type { Prisma } from "@/generated/prisma/client";

const active = {
  personStatus: "ACTIVE" as const,
  account: { is: { status: "NORMAL" as const, forcePasswordChange: false, confidentialityConfirmedAt: { not: null } } },
};

export async function activeAdministrators(tx: Prisma.TransactionClient, now = new Date()) {
  const people = await tx.person.findMany({
    where: {
      ...active,
      roleAssignments: { some: { roleCode: { in: ["ADMIN", "SUPER_ADMIN"] }, effectiveAt: { lte: now }, OR: [{ expiredAt: null }, { expiredAt: { gt: now } }] } },
    },
    select: { id: true },
  });
  return people.map(({ id }) => id);
}

export async function activeAreaStaff(tx: Prisma.TransactionClient, areaId: string, now = new Date()) {
  const people = await tx.person.findMany({
    where: {
      ...active,
      roleAssignments: { some: {
        roleCode: "TOWNSHIP_STAFF",
        effectiveAt: { lte: now },
        OR: [{ expiredAt: null }, { expiredAt: { gt: now } }],
      } },
      appointments: { some: {
        effectiveAt: { lte: now },
        OR: [{ expiredAt: null }, { expiredAt: { gt: now } }],
        organization: { status: "ACTIVE", areaMappings: { some: { areaId, effectiveAt: { lte: now }, OR: [{ expiredAt: null }, { expiredAt: { gt: now } }] } } },
      } },
    },
    select: { id: true },
  });
  return people.map(({ id }) => id);
}

export async function activeOrganizationStaff(tx: Prisma.TransactionClient, organizationId: string, now = new Date()) {
  const people = await tx.person.findMany({
    where: {
      ...active,
      appointments: { some: { organizationId, effectiveAt: { lte: now }, OR: [{ expiredAt: null }, { expiredAt: { gt: now } }], organization: { status: "ACTIVE" } } },
    },
    select: { id: true },
  });
  return people.map(({ id }) => id);
}
