import { describe, expect, it } from "vitest";
import type { RoleCode } from "@/generated/prisma/client";
import { authorizeActor, resolveCapabilities, type PermissionActor } from "@/modules/permissions";
import { FakeMapRenderer, resolveMapCenter } from "@/modules/map/client/map-renderer";
import { parseAndValidateGeoJson } from "@/modules/map/geojson";
import { assertActiveAreaForBoundaryActivation, assertActiveDispatchOrganization } from "@/modules/map/governance-rules";
import { matchesMemberMapFilters, selectMemberMapMembership } from "@/modules/map/member-map-rules";
import { TencentNavigationAdapter } from "@/modules/map/navigation-adapter";
import { coordinateSchema, enterpriseMapPointsQuerySchema } from "@/modules/map/schemas";
import { isEnterpriseResponsibleAreaType, validateCoordinatePair } from "@/modules/map/validators";

const TEST_POLYGON = { type: "Feature", properties: { note: "TEST ONLY" }, geometry: { type: "Polygon", coordinates: [[[119.3, 33.2], [119.4, 33.2], [119.4, 33.3], [119.3, 33.2]]] } };
function actor(roles: RoleCode[]): PermissionActor { const capabilities = resolveCapabilities(roles, new Set()); return { personId: "p", accountId: "a", accountStatus: "NORMAL", permissionVersion: BigInt(1), effectiveRoles: roles, capabilities, specialPermissions: new Set(), selfPersonId: "p", townshipAreaIds: [], departmentAreaIds: [], hasGlobalPublished: true, hasGlobalOperational: roles.includes("ADMIN") || roles.includes("SUPER_ADMIN"), hasSystem: roles.includes("SUPER_ADMIN"), currentBatchMember: roles.includes("MEMBER_CURRENT"), configurationIssues: [] }; }

describe("M2-002 GeoJSON and coordinate validation", () => {
  it("accepts TEST Polygon/FeatureCollection and calculates a stable SHA-256", () => { const first = parseAndValidateGeoJson(TEST_POLYGON); const second = parseAndValidateGeoJson(JSON.stringify(TEST_POLYGON)); expect(first.checksum).toMatch(/^[a-f0-9]{64}$/); expect(second.checksum).toBe(first.checksum); });
  it.each([
    { type: "Point", coordinates: [119, 33] },
    { type: "Polygon", coordinates: [[[181, 33], [119, 33], [119, 34], [181, 33]]] },
    { type: "Polygon", coordinates: [[[119, 33], [120, 33], [120, 34], [119, 34]]] },
    "<script>alert(1)</script>",
  ])("rejects invalid GeoJSON: %s", (value) => expect(() => parseAndValidateGeoJson(value)).toThrow(expect.objectContaining({ code: "MAP_GEOJSON_INVALID" })));
  it("bounds both coordinates and responsible-area types", () => { expect(validateCoordinatePair(33.2, 119.3)).toBe(true); expect(validateCoordinatePair(91, 119)).toBe(false); expect(coordinateSchema.safeParse({ latitude: 33.2, longitude: 181, reason: "TEST" }).success).toBe(false); expect(isEnterpriseResponsibleAreaType("PARK")).toBe(true); expect(isEnterpriseResponsibleAreaType("COUNTY")).toBe(false); });
});

describe("M2-002 adapters and permissions", () => {
  it("builds official Tencent URI intents without route calculation or location collection", () => { const adapter = new TencentNavigationAdapter(); const coordinate = adapter.createIntent({ name: "TEST enterprise", address: "TEST address", latitude: 33.2, longitude: 119.3 }); expect(coordinate).toMatchObject({ available: true }); if (coordinate.available) expect(coordinate.url).toContain("https://apis.map.qq.com/uri/v1/marker"); const address = adapter.createIntent({ name: "TEST", address: "TEST address" }); if (address.available) expect(address.url).toContain("/uri/v1/search"); expect(adapter.createIntent({ name: "", address: "" })).toEqual({ available: false, reason: "MISSING_DESTINATION" }); });
  it("uses a fake renderer in tests without Tencent network", async () => { const renderer = new FakeMapRenderer(); await renderer.render({ container: {} as HTMLElement, boundaries: [], points: [] }); expect(renderer.calls).toHaveLength(1); renderer.destroy(); expect(renderer.calls).toHaveLength(0); });
  it("does not invent a map center when neither confirmed center nor marker exists", () => { expect(resolveMapCenter({ points: [] })).toBeNull(); expect(resolveMapCenter({ center: { latitude: 1, longitude: 2 }, points: [] })).toEqual({ latitude: 1, longitude: 2 }); });
  it("allows every internal role to read but only ADMIN/SUPER to govern", async () => { for (const role of ["MEMBER_CURRENT", "MEMBER_ALUMNI_PLATFORM", "GROUP_LEADER", "MINISTER", "TOWNSHIP_STAFF", "DEPARTMENT_STAFF", "ADMIN", "SUPER_ADMIN"] as RoleCode[]) await expect(authorizeActor({ actor: actor([role]), action: "enterprise.view" })).resolves.toMatchObject({ allowed: true }); await expect(authorizeActor({ actor: actor(["MEMBER_CURRENT"]), action: "enterprise.map.manage" })).rejects.toMatchObject({ code: "FORBIDDEN_CAPABILITY" }); await expect(authorizeActor({ actor: actor(["ADMIN"]), action: "enterprise.map.manage" })).resolves.toMatchObject({ allowed: true }); });
});

describe("M2-002 member-map and governance rules", () => {
  const now = new Date("2026-08-27T00:00:00Z");
  const historical = { id: "history", batchId: "old", status: "ACTIVE", startDate: new Date("2025-01-01"), endDate: new Date("2025-12-31") };
  const future = { id: "future", batchId: "next", status: "ACTIVE", startDate: new Date("2027-01-01"), endDate: null };
  it("never uses a future membership and selects the newest already-started alumni history", () => { expect(selectMemberMapMembership("alumni", [future], "current", now)).toBeUndefined(); expect(selectMemberMapMembership("alumni", [future, historical], "current", now)?.id).toBe("history"); });
  it("applies keyword and dispatch filters before unlocated classification", () => { expect(matchesMemberMapFilters({ personName: "目标人员", organization: null, professionalDirection: "制造", keyword: "其他" })).toBe(false); expect(matchesMemberMapFilters({ personName: "目标人员", organization: null, professionalDirection: "制造", keyword: "制造" })).toBe(true); expect(matchesMemberMapFilters({ personName: "目标人员", organization: null, professionalDirection: null, dispatchOrganizationId: "dispatch" })).toBe(false); expect(matchesMemberMapFilters({ personName: "目标人员", organization: { id: "dispatch", name: "派出单位" }, professionalDirection: null, dispatchOrganizationId: "dispatch" })).toBe(true); });
  it("rejects inactive area and dispatch-organization governance after lock", () => { expect(() => assertActiveAreaForBoundaryActivation({ status: "INACTIVE" })).toThrow(expect.objectContaining({ code: "MAP_AREA_INACTIVE" })); expect(() => assertActiveDispatchOrganization({ type: "DISPATCH_UNIT", status: "INACTIVE" })).toThrow(expect.objectContaining({ code: "MAP_ORGANIZATION_INACTIVE" })); });
  it("parses the canonical enterprise map-points query and caps pageSize", () => { expect(enterpriseMapPointsQuerySchema.parse({ areaId: "11111111-1111-4111-8111-111111111111", page: "2", pageSize: "100" })).toMatchObject({ page: 2, pageSize: 100 }); expect(enterpriseMapPointsQuerySchema.safeParse({ areaId: "11111111-1111-4111-8111-111111111111", pageSize: "101" }).success).toBe(false); });
});
