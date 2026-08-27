import type { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { authorizeActor } from "@/modules/permissions/authorization";
import type { PermissionActor } from "@/modules/permissions/types";
import { writeFoundationAudit, type MutationContext } from "./audit";
import { FoundationError } from "./errors";
import { classifyMember, roleLabel } from "./rules";
import { capabilityProfileSchema } from "./schemas";

type ServiceInput = { actor: PermissionActor; context?: MutationContext };
type MemberKind = "current" | "alumni";

const memberInclude = {
  account: { select: { phone: true, status: true } },
  batchMemberships: {
    include: {
      batch: { select: { id: true, name: true, year: true, status: true, isCurrent: true } },
      dispatchOrganization: { select: { id: true, name: true, type: true } },
      postOrganization: { select: { id: true, name: true, type: true } },
    },
    orderBy: { startDate: "desc" as const },
  },
  roleAssignments: { orderBy: { effectiveAt: "desc" as const } },
  groupLeaderAssignments: { orderBy: { effectiveAt: "desc" as const } },
  appointments: {
    include: { organization: { select: { id: true, name: true, type: true } } },
    orderBy: { effectiveAt: "desc" as const },
  },
  memberCapabilityProfile: {
    include: {
      industries: { include: { industry: { select: { id: true, name: true } } } },
      preferredDemandTypes: true,
    },
  },
} satisfies Prisma.PersonInclude;

function cleanOptional(value: string | undefined): string | null {
  return value?.trim() ? value.trim() : null;
}

function publicMember(person: Prisma.PersonGetPayload<{ include: typeof memberInclude }>, currentBatchId: string | null, now: Date) {
  const kind = classifyMember({
    memberships: person.batchMemberships,
    roles: person.roleAssignments,
    currentBatchId,
    hasAccount: person.account !== null,
    now,
  });
  const effectiveRoles = person.roleAssignments
    .filter((role) => role.effectiveAt <= now && (role.expiredAt === null || role.expiredAt > now))
    .map((role) => ({ code: role.roleCode, label: roleLabel(role.roleCode) }));
  return {
    id: person.id,
    name: person.name,
    kind,
    contactPhone: person.account?.phone ?? person.contactPhone,
    hasLoginAccount: person.account !== null,
    accountStatus: person.account?.status ?? null,
    roles: effectiveRoles,
    memberships: person.batchMemberships.map((membership) => ({
      id: membership.id, status: membership.status, startDate: membership.startDate, endDate: membership.endDate,
      positionTitle: membership.positionTitle, batch: membership.batch,
      dispatchOrganization: membership.dispatchOrganization, postOrganization: membership.postOrganization,
    })),
    appointments: person.appointments.map((appointment) => ({
      id: appointment.id, positionTitle: appointment.positionTitle, effectiveAt: appointment.effectiveAt,
      expiredAt: appointment.expiredAt, isPrimary: appointment.isPrimary, organization: appointment.organization,
    })),
    capabilityProfile: person.memberCapabilityProfile ? {
      professionalDirection: person.memberCapabilityProfile.professionalDirection,
      coordinatableResources: person.memberCapabilityProfile.coordinatableResources,
      personalIntroduction: person.memberCapabilityProfile.personalIntroduction,
      industries: person.memberCapabilityProfile.industries.map(({ industry }) => industry),
      preferredDemandTypes: person.memberCapabilityProfile.preferredDemandTypes.map(({ demandType }) => demandType),
      updatedAt: person.memberCapabilityProfile.updatedAt,
    } : null,
  };
}

export class MemberService {
  constructor(private readonly prisma = getPrismaClient()) {}

  private async currentBatchId(): Promise<string | null> {
    const batches = await this.prisma.batch.findMany({ where: { isCurrent: true, status: "ACTIVE" }, select: { id: true } });
    if (batches.length > 1) throw new FoundationError("BATCH_STATE_CONFLICT", "当前批次配置不唯一");
    return batches[0]?.id ?? null;
  }

  async list(input: ServiceInput & { query: { kind: MemberKind; keyword?: string; page: number; pageSize: number } }) {
    await authorizeActor({ actor: input.actor, action: "member.view", resource: { resourceType: "member", requiredScope: "GLOBAL_PUBLISHED" } });
    const [currentBatchId, people] = await Promise.all([
      this.currentBatchId(),
      this.prisma.person.findMany({
        where: {
          personStatus: "ACTIVE",
          ...(input.query.keyword ? { name: { contains: input.query.keyword } } : {}),
          OR: [{ batchMemberships: { some: {} } }, { roleAssignments: { some: { roleCode: { in: ["MEMBER_CURRENT", "MEMBER_ALUMNI_PLATFORM"] } } } }],
        },
        include: memberInclude,
        orderBy: [{ name: "asc" }, { id: "asc" }],
      }),
    ]);
    const now = new Date();
    const all = people.map((person) => publicMember(person, currentBatchId, now)).filter((person) => person.kind === input.query.kind);
    const offset = (input.query.page - 1) * input.query.pageSize;
    return { items: all.slice(offset, offset + input.query.pageSize), total: all.length, page: input.query.page, pageSize: input.query.pageSize };
  }

  async detail(input: ServiceInput & { personId: string }) {
    await authorizeActor({ actor: input.actor, action: "member.view", resource: { resourceType: "member", requiredScope: "GLOBAL_PUBLISHED" } });
    const [currentBatchId, person] = await Promise.all([
      this.currentBatchId(),
      this.prisma.person.findUnique({ where: { id: input.personId }, include: memberInclude }),
    ]);
    if (!person) throw new FoundationError("MEMBER_NOT_FOUND", "团员不存在");
    const result = publicMember(person, currentBatchId, new Date());
    if (!result.kind) throw new FoundationError("MEMBER_NOT_FOUND", "该人员不是团员或往届成员");
    return result;
  }

  async updateCapabilityProfile(input: ServiceInput & { personId: string; profile: unknown }) {
    await authorizeActor({ actor: input.actor, action: "member.profile.self_edit", resource: { resourceType: "member", requiredScope: "SELF", ownerPersonId: input.personId } });
    const profile = capabilityProfileSchema.parse(input.profile);
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM persons WHERE id = ${input.personId} FOR UPDATE`;
      if (locked.length !== 1) throw new FoundationError("MEMBER_NOT_FOUND", "团员不存在");
      const industryIds = [...new Set(profile.industryIds)];
      if (industryIds.length > 0 && await tx.memberIndustry.count({ where: { id: { in: industryIds }, status: "ACTIVE" } }) !== industryIds.length) {
        throw new FoundationError("MEMBER_STATE_CONFLICT", "包含不存在或已停用的行业");
      }
      const before = await tx.memberCapabilityProfile.findUnique({ where: { personId: input.personId }, include: { industries: true, preferredDemandTypes: true } });
      await tx.memberCapabilityProfile.upsert({
        where: { personId: input.personId },
        create: {
          personId: input.personId, updatedByPersonId: input.actor.personId,
          professionalDirection: cleanOptional(profile.professionalDirection),
          coordinatableResources: cleanOptional(profile.coordinatableResources),
          personalIntroduction: cleanOptional(profile.personalIntroduction),
        },
        update: {
          updatedByPersonId: input.actor.personId,
          professionalDirection: cleanOptional(profile.professionalDirection),
          coordinatableResources: cleanOptional(profile.coordinatableResources),
          personalIntroduction: cleanOptional(profile.personalIntroduction),
        },
      });
      await tx.memberCapabilityIndustry.deleteMany({ where: { personId: input.personId } });
      if (industryIds.length) await tx.memberCapabilityIndustry.createMany({ data: industryIds.map((industryId) => ({ personId: input.personId, industryId })) });
      await tx.memberPreferredDemandType.deleteMany({ where: { personId: input.personId } });
      const demandTypes = [...new Set(profile.preferredDemandTypes)];
      if (demandTypes.length) await tx.memberPreferredDemandType.createMany({ data: demandTypes.map((demandType) => ({ personId: input.personId, demandType })) });
      const after = { ...profile, industryIds, preferredDemandTypes: demandTypes } satisfies Prisma.InputJsonObject;
      await writeFoundationAudit(tx, { ...input, actionCode: "MEMBER_CAPABILITY_UPDATED", entityType: "MEMBER_CAPABILITY_PROFILE", entityId: input.personId, before: before ? { id: before.id } : undefined, after });
      return after;
    });
  }

  async options(input: ServiceInput) {
    await authorizeActor({ actor: input.actor, action: "member.view", resource: { resourceType: "member", requiredScope: "GLOBAL_PUBLISHED" } });
    return { industries: await this.prisma.memberIndustry.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }) };
  }

  async collaborationCandidates(input: ServiceInput & { query: { keyword?: string; limit: number } }) {
    await authorizeActor({ actor: input.actor, action: "member.view", resource: { resourceType: "member", requiredScope: "GLOBAL_PUBLISHED" } });
    const currentBatchId = await this.currentBatchId();
    if (!currentBatchId) throw new FoundationError("BATCH_STATE_CONFLICT", "当前有效批次不存在");
    const now = new Date();
    return this.prisma.person.findMany({
      where: {
        personStatus: "ACTIVE",
        ...(input.query.keyword ? { name: { contains: input.query.keyword } } : {}),
        account: {
          status: "NORMAL",
          forcePasswordChange: false,
          confidentialityConfirmedAt: { not: null },
        },
        batchMemberships: { some: {
          batchId: currentBatchId,
          status: "ACTIVE",
          startDate: { lte: now },
          OR: [{ endDate: null }, { endDate: { gt: now } }],
        } },
        roleAssignments: { some: {
          roleCode: "MEMBER_CURRENT",
          effectiveAt: { lte: now },
          OR: [{ expiredAt: null }, { expiredAt: { gt: now } }],
        } },
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: input.query.limit,
      select: { id: true, name: true },
    });
  }
}
