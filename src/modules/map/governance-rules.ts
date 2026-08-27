import { MapError } from "./errors";

export function assertActiveAreaForBoundaryActivation(area: { status: string } | undefined): void {
  if (!area) throw new MapError("MAP_AREA_NOT_FOUND", "行政区域不存在", 404);
  if (area.status !== "ACTIVE") throw new MapError("MAP_AREA_INACTIVE", "已停用行政区域不可激活边界", 409);
}

export function assertActiveDispatchOrganization(organization: { type: string; status: string } | undefined): void {
  if (!organization) throw new MapError("MAP_ORGANIZATION_NOT_FOUND", "派出单位不存在", 404);
  if (organization.type !== "DISPATCH_UNIT") throw new MapError("MAP_ORGANIZATION_TYPE_INVALID", "仅可治理派出单位坐标", 422);
  if (organization.status !== "ACTIVE") throw new MapError("MAP_ORGANIZATION_INACTIVE", "已停用派出单位不可治理坐标", 409);
}
