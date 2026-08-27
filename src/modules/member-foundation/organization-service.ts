import { getPrismaClient } from "@/lib/db/prisma";
import { authorizeActor } from "@/modules/permissions/authorization";
import { bumpPermissionVersions } from "@/modules/permissions/permission-invalidation";
import type { PermissionActor } from "@/modules/permissions/types";
import { writeFoundationAudit, type MutationContext } from "./audit";
import { FoundationError } from "./errors";
import { appointmentCreateSchema, departmentAreaRelationSchema, endRecordSchema, organizationCreateSchema } from "./schemas";

type ServiceInput = { actor: PermissionActor; context?: MutationContext };
const activeAt = (now: Date) => ({ effectiveAt: { lte: now }, OR: [{ expiredAt: null }, { expiredAt: { gt: now } }] });
const optional = (value: string | undefined) => value?.trim() ? value.trim() : null;

export class OrganizationService {
  constructor(private readonly prisma = getPrismaClient()) {}

  async list(input: ServiceInput & { keyword?: string }) {
    await authorizeActor({ actor: input.actor, action: "contacts.view", resource: { resourceType: "organization", requiredScope: "GLOBAL_PUBLISHED" } });
    const now = new Date();
    const organizations = await this.prisma.organization.findMany({
      where: { status: "ACTIVE", ...(input.keyword ? { name: { contains: input.keyword } } : {}) },
      orderBy: [{ type: "asc" }, { name: "asc" }],
      include: {
        appointments: {
          where: activeAt(now),
          orderBy: [{ isPrimary: "desc" }, { effectiveAt: "asc" }],
          include: { person: { include: { account: { select: { phone: true } } } } },
        },
      },
    });
    return organizations.map((organization) => ({
      id: organization.id, name: organization.name, type: organization.type,
      phone: organization.phone, address: organization.address,
      staffCount: organization.appointments.length,
      staff: organization.appointments.map((appointment) => ({
        appointmentId: appointment.id, personId: appointment.personId, name: appointment.person.name,
        positionTitle: appointment.positionTitle, isPrimary: appointment.isPrimary,
        phone: appointment.person.account?.phone ?? appointment.person.contactPhone,
      })),
    }));
  }

  async detail(input: ServiceInput & { organizationId: string }) {
    const items = await this.list(input);
    const organization = items.find(({ id }) => id === input.organizationId);
    if (!organization) throw new FoundationError("ORGANIZATION_NOT_FOUND", "组织不存在或已停用");
    const now = new Date();
    const relations = await this.prisma.departmentTownshipRelation.findMany({
      where: { departmentOrganizationId: input.organizationId, ...activeAt(now) },
      include: { area: { select: { id: true, name: true, type: true } } }, orderBy: { effectiveAt: "asc" },
    });
    return { ...organization, townshipRelations: relations.map((relation) => ({ id: relation.id, area: relation.area, effectiveAt: relation.effectiveAt })) };
  }

  async adminList(input: ServiceInput) {
    await authorizeActor({ actor: input.actor, action: "organization.manage", resource: { resourceType: "organization", requiredScope: "GLOBAL_OPERATIONAL" } });
    return this.prisma.organization.findMany({
      orderBy: [{ status: "asc" }, { type: "asc" }, { name: "asc" }],
      include: { _count: { select: { appointments: true, departmentAreaRelations: true } } },
    });
  }

  async create(input: ServiceInput & { organization: unknown }) {
    await authorizeActor({ actor: input.actor, action: "organization.manage", resource: { resourceType: "organization", requiredScope: "GLOBAL_OPERATIONAL" } });
    const value = organizationCreateSchema.parse(input.organization);
    return this.prisma.$transaction(async (tx) => {
      if (value.parentId && !await tx.organization.findFirst({ where: { id: value.parentId, status: "ACTIVE" } })) {
        throw new FoundationError("ORGANIZATION_RELATION_INVALID", "上级组织不存在或已停用");
      }
      const organization = await tx.organization.create({ data: { ...value, parentId: value.parentId ?? null, phone: optional(value.phone), address: optional(value.address) } });
      await writeFoundationAudit(tx, { ...input, actionCode: "ORGANIZATION_CREATED", entityType: "ORGANIZATION", entityId: organization.id, after: { name: organization.name, type: organization.type } });
      return organization;
    });
  }

  async createAppointment(input: ServiceInput & { appointment: unknown }) {
    await authorizeActor({ actor: input.actor, action: "appointment.manage", resource: { resourceType: "appointment", requiredScope: "GLOBAL_OPERATIONAL" } });
    const value = appointmentCreateSchema.parse(input.appointment);
    return this.prisma.$transaction(async (tx) => {
      const personRows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM persons WHERE id = ${value.personId} FOR UPDATE`;
      if (!personRows.length) throw new FoundationError("MEMBER_NOT_FOUND", "人员不存在");
      if (!await tx.organization.findFirst({ where: { id: value.organizationId, status: "ACTIVE" } })) throw new FoundationError("ORGANIZATION_NOT_FOUND", "组织不存在或已停用");
      if (value.isPrimary) await tx.appointment.updateMany({ where: { personId: value.personId, ...activeAt(value.effectiveAt) }, data: { isPrimary: false } });
      const appointment = await tx.appointment.create({ data: { ...value, expiredAt: value.expiredAt ?? null } });
      await bumpPermissionVersions([value.personId], tx);
      await writeFoundationAudit(tx, { ...input, actionCode: "APPOINTMENT_CREATED", entityType: "APPOINTMENT", entityId: appointment.id, after: { personId: value.personId, organizationId: value.organizationId, positionTitle: value.positionTitle } });
      return appointment;
    });
  }

  async endAppointment(input: ServiceInput & { appointmentId: string; command: unknown }) {
    await authorizeActor({ actor: input.actor, action: "appointment.manage", resource: { resourceType: "appointment", requiredScope: "GLOBAL_OPERATIONAL" } });
    const command = endRecordSchema.parse(input.command);
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM appointments WHERE id = ${input.appointmentId} FOR UPDATE`;
      if (!rows.length) throw new FoundationError("APPOINTMENT_NOT_FOUND", "任职记录不存在");
      const appointment = await tx.appointment.findUniqueOrThrow({ where: { id: input.appointmentId } });
      if (command.expiredAt <= appointment.effectiveAt) throw new FoundationError("ORGANIZATION_RELATION_INVALID", "任职结束时间必须晚于开始时间");
      if (appointment.expiredAt && appointment.expiredAt <= new Date()) throw new FoundationError("MEMBER_STATE_CONFLICT", "任职记录已经结束");
      const updated = await tx.appointment.update({ where: { id: appointment.id }, data: { expiredAt: command.expiredAt } });
      await bumpPermissionVersions([appointment.personId], tx);
      await writeFoundationAudit(tx, { ...input, actionCode: "APPOINTMENT_ENDED", entityType: "APPOINTMENT", entityId: appointment.id, reason: command.reason, before: { expiredAt: appointment.expiredAt?.toISOString() ?? null }, after: { expiredAt: command.expiredAt.toISOString() } });
      return updated;
    });
  }

  async createDepartmentAreaRelation(input: ServiceInput & { relation: unknown }) {
    await authorizeActor({ actor: input.actor, action: "department_township_relation.manage", resource: { resourceType: "organization", requiredScope: "GLOBAL_OPERATIONAL" } });
    const value = departmentAreaRelationSchema.parse(input.relation);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM organizations WHERE id = ${value.departmentOrganizationId} FOR UPDATE`;
      const [department, area] = await Promise.all([
        tx.organization.findFirst({ where: { id: value.departmentOrganizationId, type: "DEPARTMENT", status: "ACTIVE" } }),
        tx.administrativeArea.findFirst({ where: { id: value.areaId, status: "ACTIVE", type: { in: ["TOWNSHIP", "PARK", "HIGH_TECH_ZONE", "DEVELOPMENT_ZONE"] } } }),
      ]);
      if (!department || !area) throw new FoundationError("ORGANIZATION_RELATION_INVALID", "仅可关联有效部门与镇区/园区");
      const overlap = await tx.departmentTownshipRelation.findFirst({ where: {
        departmentOrganizationId: value.departmentOrganizationId, areaId: value.areaId,
        effectiveAt: { lt: value.expiredAt ?? new Date("9999-12-31") },
        OR: [{ expiredAt: null }, { expiredAt: { gt: value.effectiveAt } }],
      } });
      if (overlap) throw new FoundationError("MEMBER_STATE_CONFLICT", "该部门与镇区已有重叠的有效关系");
      const relation = await tx.departmentTownshipRelation.create({ data: { ...value, expiredAt: value.expiredAt ?? null } });
      const affected = await tx.appointment.findMany({ where: { organizationId: value.departmentOrganizationId, ...activeAt(new Date()) }, select: { personId: true } });
      await bumpPermissionVersions(affected.map(({ personId }) => personId), tx);
      await writeFoundationAudit(tx, { ...input, actionCode: "DEPARTMENT_TOWNSHIP_RELATION_CREATED", entityType: "DEPARTMENT_TOWNSHIP_RELATION", entityId: relation.id, after: { departmentOrganizationId: value.departmentOrganizationId, areaId: value.areaId } });
      return relation;
    });
  }

  async endDepartmentAreaRelation(input: ServiceInput & { relationId: string; command: unknown }) {
    await authorizeActor({ actor: input.actor, action: "department_township_relation.manage", resource: { resourceType: "organization", requiredScope: "GLOBAL_OPERATIONAL" } });
    const command = endRecordSchema.parse(input.command);
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM department_township_relations WHERE id = ${input.relationId} FOR UPDATE`;
      if (!rows.length) throw new FoundationError("ORGANIZATION_RELATION_INVALID", "部门镇区关系不存在");
      const relation = await tx.departmentTownshipRelation.findUniqueOrThrow({ where: { id: input.relationId } });
      if (command.expiredAt <= relation.effectiveAt) throw new FoundationError("ORGANIZATION_RELATION_INVALID", "关系结束时间必须晚于开始时间");
      const updated = await tx.departmentTownshipRelation.update({ where: { id: relation.id }, data: { expiredAt: command.expiredAt } });
      const affected = await tx.appointment.findMany({ where: { organizationId: relation.departmentOrganizationId, ...activeAt(new Date()) }, select: { personId: true } });
      await bumpPermissionVersions(affected.map(({ personId }) => personId), tx);
      await writeFoundationAudit(tx, { ...input, actionCode: "DEPARTMENT_TOWNSHIP_RELATION_ENDED", entityType: "DEPARTMENT_TOWNSHIP_RELATION", entityId: relation.id, reason: command.reason, after: { expiredAt: command.expiredAt.toISOString() } });
      return updated;
    });
  }
}
