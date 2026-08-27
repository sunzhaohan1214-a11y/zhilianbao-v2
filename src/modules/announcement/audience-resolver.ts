import type { Prisma } from "@/generated/prisma/client";
import type { AnnouncementAudienceInput } from "./schemas";

const activeAccount = {
  personStatus: "ACTIVE" as const,
  account: { is: { status: { not: "DISABLED" as const } } },
};

export async function resolveAudience(
  tx: Prisma.TransactionClient,
  rules: readonly AnnouncementAudienceInput[],
  now = new Date(),
): Promise<string[]> {
  const ids = new Set<string>();
  for (const rule of rules) {
    if (rule.type === "ALL") {
      for (const person of await tx.person.findMany({ where: activeAccount, select: { id: true } })) ids.add(person.id);
    } else if (rule.type === "PERSON") {
      const person = await tx.person.findFirst({ where: { id: rule.personId, ...activeAccount }, select: { id: true } });
      if (person) ids.add(person.id);
    } else if (rule.type === "ROLE") {
      const people = await tx.person.findMany({
        where: {
          ...activeAccount,
          roleAssignments: { some: { roleCode: rule.roleCode, effectiveAt: { lte: now }, OR: [{ expiredAt: null }, { expiredAt: { gt: now } }] } },
        },
        select: { id: true },
      });
      for (const person of people) ids.add(person.id);
    } else if (rule.type === "ORGANIZATION") {
      const people = await tx.person.findMany({
        where: {
          ...activeAccount,
          appointments: { some: { organizationId: rule.organizationId, effectiveAt: { lte: now }, OR: [{ expiredAt: null }, { expiredAt: { gt: now } }], organization: { status: "ACTIVE" } } },
        },
        select: { id: true },
      });
      for (const person of people) ids.add(person.id);
    } else {
      const people = await tx.person.findMany({
        where: {
          ...activeAccount,
          appointments: { some: {
            effectiveAt: { lte: now },
            OR: [{ expiredAt: null }, { expiredAt: { gt: now } }],
            organization: {
              status: "ACTIVE",
              areaMappings: { some: { areaId: rule.areaId, effectiveAt: { lte: now }, OR: [{ expiredAt: null }, { expiredAt: { gt: now } }] } },
            },
          } },
        },
        select: { id: true },
      });
      for (const person of people) ids.add(person.id);
    }
  }
  return [...ids].sort();
}
