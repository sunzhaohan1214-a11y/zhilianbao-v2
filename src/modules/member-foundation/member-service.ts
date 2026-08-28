import type { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { authorizeActor } from "@/modules/permissions/authorization";
import type { PermissionActor } from "@/modules/permissions/types";
import { writeFoundationAudit, type MutationContext } from "./audit";
import { FoundationError } from "./errors";
import { classifyMember, roleLabel } from "./rules";
import { capabilityProfileSchema } from "./schemas";
import { provisionAccountInTransaction } from "@/modules/identity/account-service";

type ServiceInput = { actor: PermissionActor; context?: MutationContext };
type MemberKind = "current" | "alumni";

export type MemberImportWrite = {
  personId?: string;
  name: string;
  phone: string;
  batchId: string;
  memberKind: "CURRENT" | "HISTORICAL_ALUMNI";
  dispatchOrganizationId?: string;
  postOrganizationId?: string;
  positionTitle?: string;
  startDate: Date;
  endDate?: Date;
  professionalDirection?: string;
  coordinatableResources?: string;
  createAccount: boolean;
  preparedPasswordHash?: string;
};

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

  async applyImportInTransaction(
    tx: Prisma.TransactionClient,
    input: ServiceInput & { member: MemberImportWrite; reason: string },
  ) {
    await authorizeActor({ actor: input.actor, action: "member.manage", resource: { resourceType: "member", requiredScope: "GLOBAL_OPERATIONAL" } });
    const value = input.member;
    const batches = await tx.$queryRaw<Array<{ id: string; status: "PLANNED" | "ACTIVE" | "CLOSED" }>>`SELECT id, status FROM batches WHERE id = ${value.batchId} FOR UPDATE`;
    if (batches.length !== 1) throw new FoundationError("BATCH_STATE_CONFLICT", "导入目标批次不存在");
    if (value.memberKind === "CURRENT" && batches[0].status !== "ACTIVE") throw new FoundationError("BATCH_STATE_CONFLICT", "在任成员不能导入到非活动批次");
    let person = value.personId ? await tx.person.findUnique({ where: { id: value.personId }, include: { account: true } }) : null;
    if (value.personId && !person) throw new FoundationError("MEMBER_NOT_FOUND", "匹配的人员不存在");
    if (person) {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM persons WHERE id = ${person.id} FOR UPDATE`;
      if (locked.length !== 1) throw new FoundationError("MEMBER_NOT_FOUND", "匹配的人员不存在");
      person = await tx.person.findUnique({ where: { id: person.id }, include: { account: true } });
    } else {
      person = await tx.person.create({ data: { name: value.name, contactPhone: value.phone } , include: { account: true } });
      await writeFoundationAudit(tx, { ...input, actionCode: "MEMBER_PERSON_CREATED", entityType: "PERSON", entityId: person.id, after: { name: value.name, source: "IMPORT" } });
    }
    if (!person) throw new FoundationError("MEMBER_NOT_FOUND", "人员不存在");
    if (person.personStatus !== "ACTIVE") throw new FoundationError("MEMBER_STATE_CONFLICT", "已归档人员不能通过导入写入成员身份");
    if (person.account && person.account.phone !== value.phone) {
      throw new FoundationError("MEMBER_STATE_CONFLICT", "已有账号手机号不能通过导入修改");
    }
    if (!person.account && value.createAccount) {
      if (value.memberKind !== "CURRENT" || !value.preparedPasswordHash) throw new FoundationError("MEMBER_STATE_CONFLICT", "当前导入行不能创建账号");
      await provisionAccountInTransaction(tx, { personId: person.id, phone: value.phone, passwordHash: value.preparedPasswordHash, forcePasswordChange: true, actorPersonId: input.actor.personId, requestId: input.context?.requestId });
    }
    await tx.batchMembership.upsert({
      where: { personId_batchId: { personId: person.id, batchId: value.batchId } },
      create: {
        personId: person.id, batchId: value.batchId, dispatchOrganizationId: value.dispatchOrganizationId,
        postOrganizationId: value.postOrganizationId, positionTitle: value.positionTitle,
        startDate: value.startDate, endDate: value.endDate, status: value.memberKind === "CURRENT" ? "ACTIVE" : "COMPLETED",
      },
      update: {
        dispatchOrganizationId: value.dispatchOrganizationId, postOrganizationId: value.postOrganizationId,
        positionTitle: value.positionTitle, startDate: value.startDate, endDate: value.endDate,
        status: value.memberKind === "CURRENT" ? "ACTIVE" : "COMPLETED",
      },
    });
    if (value.memberKind === "CURRENT") {
      const now = new Date();
      const activeRole = await tx.roleAssignment.findFirst({ where: { personId: person.id, roleCode: "MEMBER_CURRENT", effectiveAt: { lte: now }, OR: [{ expiredAt: null }, { expiredAt: { gt: now } }] } });
      if (!activeRole) await tx.roleAssignment.create({ data: { personId: person.id, roleCode: "MEMBER_CURRENT", effectiveAt: value.startDate, grantedByPersonId: input.actor.personId, reason: input.reason } });
    }
    if (value.professionalDirection || value.coordinatableResources) {
      await tx.memberCapabilityProfile.upsert({
        where: { personId: person.id },
        create: { personId: person.id, professionalDirection: value.professionalDirection, coordinatableResources: value.coordinatableResources, updatedByPersonId: input.actor.personId },
        update: { professionalDirection: value.professionalDirection, coordinatableResources: value.coordinatableResources, updatedByPersonId: input.actor.personId },
      });
    }
    await writeFoundationAudit(tx, { ...input, actionCode: "MEMBER_IMPORTED", entityType: "PERSON", entityId: person.id, after: { batchId: value.batchId, memberKind: value.memberKind, accountCreated: !person.account && value.createAccount } });
    return person;
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
