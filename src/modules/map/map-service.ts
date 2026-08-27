import type { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { writeFoundationAudit, type MutationContext } from "@/modules/member-foundation/audit";
import { classifyMember } from "@/modules/member-foundation/rules";
import { authorizeActor } from "@/modules/permissions/authorization";
import type { PermissionActor } from "@/modules/permissions/types";
import { MapError } from "./errors";
import { parseAndValidateGeoJson } from "./geojson";
import { assertActiveAreaForBoundaryActivation, assertActiveDispatchOrganization } from "./governance-rules";
import { matchesMemberMapFilters, selectMemberMapMembership } from "./member-map-rules";
import { boundaryActivateSchema, boundaryCreateSchema, coordinateSchema, memberMapQuerySchema } from "./schemas";
import { getMapRuntimeConfig } from "./runtime-config";
import { isEnterpriseResponsibleAreaType, validateCoordinatePair } from "./validators";

type Input = { actor: PermissionActor; context?: MutationContext };
const boundarySelect = { id: true, areaId: true, versionNo: true, geoJson: true, checksum: true, sourceFilename: true, isCurrent: true, changeReason: true, createdByPersonId: true, createdAt: true } as const;

export class MapService {
  constructor(private readonly prisma = getPrismaClient()) {}

  async listBoundaries(input: Input & { areaId?: string; includeHistory?: boolean }) {
    await authorizeActor({ actor: input.actor, action: "enterprise.view", resource: { resourceType: "map", requiredScope: "GLOBAL_PUBLISHED" } });
    const canManage = input.actor.capabilities.has("enterprise.map.manage");
    const rows = await this.prisma.mapBoundaryVersion.findMany({
      where: { ...(input.areaId ? { areaId: input.areaId } : {}), ...(!input.includeHistory || !canManage ? { isCurrent: true } : {}) },
      select: { ...boundarySelect, area: { select: { id: true, name: true, type: true, parentId: true } }, createdByPerson: { select: { id: true, name: true } } },
      orderBy: [{ areaId: "asc" }, { versionNo: "desc" }],
    });
    return { items: rows, canManage };
  }

  async createBoundary(input: Input & { boundary: unknown }) {
    await authorizeActor({ actor: input.actor, action: "enterprise.map.manage", resource: { resourceType: "map-boundary", requiredScope: "GLOBAL_OPERATIONAL" } });
    const command = boundaryCreateSchema.parse(input.boundary);
    const validated = parseAndValidateGeoJson(command.geoJson);
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM administrative_areas WHERE id = ${command.areaId} AND status = 'ACTIVE' FOR UPDATE`;
      if (locked.length !== 1) throw new MapError("MAP_AREA_NOT_FOUND", "行政区域不存在或已停用", 404);
      const latest = await tx.mapBoundaryVersion.findFirst({ where: { areaId: command.areaId }, orderBy: { versionNo: "desc" }, select: { versionNo: true } });
      const version = await tx.mapBoundaryVersion.create({ data: {
        areaId: command.areaId, versionNo: (latest?.versionNo ?? 0) + 1,
        geoJson: validated.geoJson as unknown as Prisma.InputJsonValue, checksum: validated.checksum,
        sourceFilename: command.sourceFilename || null, changeReason: command.reason,
        createdByPersonId: input.actor.personId,
      }, select: boundarySelect });
      await writeFoundationAudit(tx, { ...input, actionCode: "MAP_BOUNDARY_VERSION_CREATED", entityType: "MAP_BOUNDARY_VERSION", entityId: version.id, reason: command.reason, after: { areaId: version.areaId, versionNo: version.versionNo, checksum: version.checksum, bytes: validated.bytes } });
      return version;
    });
  }

  async activateBoundary(input: Input & { boundaryId: string; command: unknown }) {
    await authorizeActor({ actor: input.actor, action: "enterprise.map.manage", resource: { resourceType: "map-boundary", requiredScope: "GLOBAL_OPERATIONAL" } });
    const command = boundaryActivateSchema.parse(input.command);
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.mapBoundaryVersion.findUnique({ where: { id: input.boundaryId }, select: boundarySelect });
      if (!target) throw new MapError("MAP_BOUNDARY_NOT_FOUND", "边界版本不存在", 404);
      const locked = await tx.$queryRaw<Array<{ id: string; status: string }>>`SELECT id, status FROM administrative_areas WHERE id = ${target.areaId} FOR UPDATE`;
      assertActiveAreaForBoundaryActivation(locked[0]);
      const current = await tx.mapBoundaryVersion.findMany({ where: { areaId: target.areaId, isCurrent: true }, select: { id: true, versionNo: true } });
      await tx.mapBoundaryVersion.updateMany({ where: { areaId: target.areaId, isCurrent: true }, data: { isCurrent: false } });
      await tx.mapBoundaryVersion.update({ where: { id: target.id }, data: { isCurrent: true } });
      const count = await tx.mapBoundaryVersion.count({ where: { areaId: target.areaId, isCurrent: true } });
      if (count !== 1) throw new MapError("MAP_BOUNDARY_STATE_CONFLICT", "边界激活后 current 状态不唯一", 409);
      await writeFoundationAudit(tx, { ...input, actionCode: "MAP_BOUNDARY_VERSION_ACTIVATED", entityType: "MAP_BOUNDARY_VERSION", entityId: target.id, reason: command.reason, before: { current: current.map((item) => ({ id: item.id, versionNo: item.versionNo })) }, after: { areaId: target.areaId, versionNo: target.versionNo, isCurrent: true } });
      return { ...target, isCurrent: true };
    });
  }

  async enterpriseAreas(input: Input) {
    await authorizeActor({ actor: input.actor, action: "enterprise.view", resource: { resourceType: "enterprise-map", requiredScope: "GLOBAL_PUBLISHED" } });
    const [areas, county] = await Promise.all([
      this.prisma.administrativeArea.findMany({ where: { status: "ACTIVE", type: { in: ["TOWNSHIP", "PARK", "HIGH_TECH_ZONE", "DEVELOPMENT_ZONE"] } }, include: { boundaryVersions: { where: { isCurrent: true }, select: boundarySelect } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
      this.prisma.administrativeArea.findFirst({ where: { status: "ACTIVE", type: "COUNTY" }, include: { boundaryVersions: { where: { isCurrent: true }, select: boundarySelect } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    ]);
    const counts = await this.prisma.enterprise.groupBy({ by: ["responsibleAreaId"], where: { status: "NORMAL", responsibleAreaId: { in: areas.map(({ id }) => id) } }, _count: { _all: true } });
    const countByArea = new Map(counts.map((row) => [row.responsibleAreaId, row._count._all]));
    return { areas: areas.map((area) => ({ ...area, count: countByArea.get(area.id) ?? 0, currentBoundaryVersion: area.boundaryVersions[0] ?? null, boundaryVersions: undefined })), countyBoundary: county?.boundaryVersions[0] ?? null, runtime: getMapRuntimeConfig() };
  }

  async enterpriseAreaDetail(input: Input & { areaId: string; page: number; pageSize: number }) {
    await authorizeActor({ actor: input.actor, action: "enterprise.view", resource: { resourceType: "enterprise-map", requiredScope: "GLOBAL_PUBLISHED" } });
    const area = await this.prisma.administrativeArea.findFirst({ where: { id: input.areaId, status: "ACTIVE" }, include: { boundaryVersions: { where: { isCurrent: true }, select: boundarySelect } } });
    if (!area || !isEnterpriseResponsibleAreaType(area.type)) throw new MapError("MAP_AREA_NOT_FOUND", "企业负责区域不存在", 404);
    const where = { responsibleAreaId: area.id, status: "NORMAL" as const };
    const [total, enterprises] = await Promise.all([
      this.prisma.enterprise.count({ where }),
      this.prisma.enterprise.findMany({ where, include: { primaryContact: { select: { id: true, name: true, phone: true, positionTitle: true, status: true } }, tagRelations: { include: { tag: { select: { id: true, name: true } } } } }, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
    ]);
    return { area: { id: area.id, name: area.name, type: area.type }, boundary: area.boundaryVersions[0] ?? null, total, page: input.page, pageSize: input.pageSize, enterprises: enterprises.map((item) => ({ id: item.id, name: item.name, address: item.address, mainProducts: item.mainProducts, responsibleArea: { id: area.id, name: area.name }, latitude: item.latitude?.toString() ?? null, longitude: item.longitude?.toString() ?? null, hasValidCoordinate: item.latitude !== null && item.longitude !== null && validateCoordinatePair(Number(item.latitude), Number(item.longitude)), primaryContact: item.primaryContact?.status === "ACTIVE" ? item.primaryContact : null, tags: item.tagRelations.map(({ tag }) => tag) })) };
  }

  async memberMap(input: Input & { query: unknown }) {
    await authorizeActor({ actor: input.actor, action: "member.view", resource: { resourceType: "member-map", requiredScope: "GLOBAL_PUBLISHED" } });
    const query = memberMapQuerySchema.parse(input.query);
    const [batches, dispatchOrganizations] = await Promise.all([
      this.prisma.batch.findMany({ where: { isCurrent: true, status: "ACTIVE" }, select: { id: true } }),
      this.prisma.organization.findMany({ where: { status: "ACTIVE", type: "DISPATCH_UNIT" }, select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] }),
    ]);
    if (batches.length > 1) throw new MapError("MAP_MEMBER_BATCH_CONFLICT", "当前活动批次配置不唯一", 409);
    const currentBatchId = batches[0]?.id ?? null; const now = new Date();
    const people = await this.prisma.person.findMany({ where: { personStatus: "ACTIVE", OR: [{ batchMemberships: { some: {} } }, { roleAssignments: { some: { roleCode: { in: ["MEMBER_CURRENT", "MEMBER_ALUMNI_PLATFORM"] } } } }] }, include: { account: { select: { id: true } }, roleAssignments: true, memberCapabilityProfile: { select: { professionalDirection: true } }, batchMemberships: { include: { dispatchOrganization: { select: { id: true, name: true, type: true, address: true, latitude: true, longitude: true } }, batch: { select: { id: true, name: true, isCurrent: true } } }, orderBy: { startDate: "desc" } } }, orderBy: [{ name: "asc" }, { id: "asc" }] });
    const groups = new Map<string, { organization: { id: string; name: string; address: string | null; latitude: string | null; longitude: string | null; hasValidCoordinate: boolean }; members: Array<{ id: string; name: string; kind: "current" | "alumni"; professionalDirection: string | null }> }>();
    let unlocatedCount = 0;
    for (const person of people) {
      const kind = classifyMember({ memberships: person.batchMemberships, roles: person.roleAssignments, currentBatchId, hasAccount: person.account !== null, now });
      if (kind !== query.kind) continue;
      const membership = selectMemberMapMembership(kind, person.batchMemberships, currentBatchId, now);
      const candidateOrganization = membership?.dispatchOrganization ?? null;
      const organization = candidateOrganization?.type === "DISPATCH_UNIT" ? candidateOrganization : null;
      const professionalDirection = person.memberCapabilityProfile?.professionalDirection ?? null;
      if (!matchesMemberMapFilters({ personName: person.name, organization, professionalDirection, keyword: query.keyword, dispatchOrganizationId: query.dispatchOrganizationId })) continue;
      if (!organization) { unlocatedCount += 1; continue; }
      const hasValidCoordinate = organization.latitude !== null && organization.longitude !== null && validateCoordinatePair(Number(organization.latitude), Number(organization.longitude));
      if (!hasValidCoordinate) unlocatedCount += 1;
      const group = groups.get(organization.id) ?? { organization: { id: organization.id, name: organization.name, address: organization.address, latitude: organization.latitude?.toString() ?? null, longitude: organization.longitude?.toString() ?? null, hasValidCoordinate }, members: [] };
      group.members.push({ id: person.id, name: person.name, kind, professionalDirection }); groups.set(organization.id, group);
    }
    return { kind: query.kind, dispatchOrganizations, points: [...groups.values()].map((group) => ({ ...group, count: group.members.length })), unlocatedCount, runtime: getMapRuntimeConfig() };
  }

  async updateOrganizationCoordinate(input: Input & { organizationId: string; coordinate: unknown }) {
    await authorizeActor({ actor: input.actor, action: "member.map.manage", resource: { resourceType: "organization-coordinate", requiredScope: "GLOBAL_OPERATIONAL" } });
    const coordinate = coordinateSchema.parse(input.coordinate);
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string; type: string; status: string; latitude: Prisma.Decimal | null; longitude: Prisma.Decimal | null }>>`SELECT id, type, status, latitude, longitude FROM organizations WHERE id = ${input.organizationId} FOR UPDATE`;
      const before = locked[0];
      assertActiveDispatchOrganization(before);
      const updated = await tx.organization.update({ where: { id: input.organizationId }, data: { latitude: coordinate.latitude, longitude: coordinate.longitude }, select: { id: true, name: true, latitude: true, longitude: true } });
      await writeFoundationAudit(tx, { ...input, actionCode: "ORGANIZATION_COORDINATE_UPDATED", entityType: "ORGANIZATION", entityId: updated.id, reason: coordinate.reason, before: { latitude: before.latitude?.toString() ?? null, longitude: before.longitude?.toString() ?? null }, after: { latitude: updated.latitude?.toString() ?? null, longitude: updated.longitude?.toString() ?? null } });
      return { ...updated, latitude: updated.latitude?.toString() ?? null, longitude: updated.longitude?.toString() ?? null };
    });
  }

  async adminDiagnostics(input: Input) {
    await authorizeActor({ actor: input.actor, action: "enterprise.map.manage", resource: { resourceType: "map", requiredScope: "GLOBAL_OPERATIONAL" } });
    const [areasWithoutBoundary, dispatchWithoutCoordinate] = await Promise.all([
      this.prisma.administrativeArea.count({ where: { status: "ACTIVE", boundaryVersions: { none: { isCurrent: true } } } }),
      this.prisma.organization.count({ where: { status: "ACTIVE", type: "DISPATCH_UNIT", OR: [{ latitude: null }, { longitude: null }] } }),
    ]);
    return { ...getMapRuntimeConfig(), areasWithoutBoundary, dispatchWithoutCoordinate };
  }

  async adminGovernanceData(input: Input) {
    await authorizeActor({ actor: input.actor, action: "enterprise.map.manage", resource: { resourceType: "map", requiredScope: "GLOBAL_OPERATIONAL" } });
    const [areas, organizations, diagnostics] = await Promise.all([
      this.prisma.administrativeArea.findMany({ where: { status: "ACTIVE" }, include: { boundaryVersions: { select: { id: true, versionNo: true, checksum: true, sourceFilename: true, isCurrent: true, changeReason: true, createdAt: true }, orderBy: { versionNo: "desc" } } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
      this.prisma.organization.findMany({ where: { status: "ACTIVE", type: "DISPATCH_UNIT" }, select: { id: true, name: true, address: true, latitude: true, longitude: true }, orderBy: { name: "asc" } }),
      this.adminDiagnostics(input),
    ]);
    return { areas, organizations: organizations.map((item) => ({ ...item, latitude: item.latitude?.toString() ?? null, longitude: item.longitude?.toString() ?? null })), diagnostics };
  }
}
