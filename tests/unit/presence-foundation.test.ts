import { describe, expect, it } from "vitest";
import type { RoleCode } from "@/generated/prisma/client";
import { authorizeActor, resolveCapabilities, type PermissionActor } from "@/modules/permissions";
import {
  canSelfMutatePresence,
  derivePresenceStatus,
  intervalsOverlap,
  presenceCreateSchema,
} from "@/modules/presence";

function actor(roles: RoleCode[]): PermissionActor {
  return {
    personId: "person", accountId: "account", accountStatus: "NORMAL", permissionVersion: BigInt(1),
    effectiveRoles: roles, capabilities: resolveCapabilities(roles, new Set()), specialPermissions: new Set(),
    selfPersonId: "person", townshipAreaIds: [], departmentAreaIds: [], hasGlobalPublished: true,
    hasGlobalOperational: roles.includes("ADMIN") || roles.includes("SUPER_ADMIN"), hasSystem: roles.includes("SUPER_ADMIN"),
    currentBatchMember: roles.includes("MEMBER_CURRENT"), configurationIssues: [],
  };
}

describe("M2-003 Presence interval and time rules", () => {
  const now = new Date("2026-08-27T04:00:00.000Z");
  it("uses half-open intervals, so adjacent reports do not overlap", () => {
    const first = { arrivalAt: new Date("2026-08-27T00:00:00Z"), expectedDepartureAt: new Date("2026-08-27T02:00:00Z") };
    expect(intervalsOverlap(first, { arrivalAt: new Date("2026-08-27T01:59:59Z"), expectedDepartureAt: new Date("2026-08-27T03:00:00Z") })).toBe(true);
    expect(intervalsOverlap(first, { arrivalAt: first.expectedDepartureAt, expectedDepartureAt: new Date("2026-08-27T03:00:00Z") })).toBe(false);
  });

  it("derives current state without a stored current boolean", () => {
    expect(derivePresenceStatus({ arrivalAt: new Date("2026-08-27T03:00:00Z"), expectedDepartureAt: new Date("2026-08-27T05:00:00Z"), canceledAt: null }, now)).toBe("IN_BAO");
    expect(derivePresenceStatus({ arrivalAt: new Date("2026-08-27T05:00:00Z"), expectedDepartureAt: new Date("2026-08-27T06:00:00Z"), canceledAt: null }, now)).toBe("FUTURE");
    expect(derivePresenceStatus({ arrivalAt: new Date("2026-08-27T01:00:00Z"), expectedDepartureAt: now, canceledAt: null }, now)).toBe("ENDED");
    expect(derivePresenceStatus({ arrivalAt: new Date("2026-08-27T03:00:00Z"), expectedDepartureAt: new Date("2026-08-27T05:00:00Z"), canceledAt: now }, now)).toBe("CANCELED");
  });

  it("allows self mutation only while uncanceled and not ended", () => {
    expect(canSelfMutatePresence({ canceledAt: null, expectedDepartureAt: new Date("2026-08-27T04:00:00.001Z") }, now)).toBe(true);
    expect(canSelfMutatePresence({ canceledAt: null, expectedDepartureAt: now }, now)).toBe(false);
    expect(canSelfMutatePresence({ canceledAt: now, expectedDepartureAt: new Date("2026-08-28T00:00:00Z") }, now)).toBe(false);
  });

  it("requires ISO instants with an explicit offset and valid ordering", () => {
    const valid = { arrivalAt: "2026-08-27T09:00:00+08:00", expectedDepartureAt: "2026-08-27T10:00:00+08:00" };
    expect(presenceCreateSchema.parse(valid).arrivalAt.toISOString()).toBe("2026-08-27T01:00:00.000Z");
    expect(presenceCreateSchema.safeParse({ ...valid, arrivalAt: "2026-08-27T09:00:00" }).success).toBe(false);
    expect(presenceCreateSchema.safeParse({ ...valid, expectedDepartureAt: valid.arrivalAt }).success).toBe(false);
  });
});

describe("M2-003 Presence permission matrix", () => {
  it("keeps reporting to current/platform alumni and current listing to every internal role", async () => {
    for (const role of ["MEMBER_CURRENT", "MEMBER_ALUMNI_PLATFORM"] as const) {
      await expect(authorizeActor({ actor: actor([role]), action: "presence.report.self" })).resolves.toMatchObject({ allowed: true });
      await expect(authorizeActor({ actor: actor([role]), action: "presence.history.self_view" })).resolves.toMatchObject({ allowed: true });
    }
    for (const role of ["TOWNSHIP_STAFF", "DEPARTMENT_STAFF", "GROUP_LEADER", "MINISTER", "ADMIN"] as const) {
      await expect(authorizeActor({ actor: actor([role]), action: "presence.current.view" })).resolves.toMatchObject({ allowed: true });
    }
  });

  it("does not grant other-person history to coordinators or ordinary internal users", async () => {
    for (const role of ["TOWNSHIP_STAFF", "DEPARTMENT_STAFF", "GROUP_LEADER", "MINISTER"] as const) {
      await expect(authorizeActor({ actor: actor([role]), action: "presence.history.admin_view" })).rejects.toMatchObject({ code: "FORBIDDEN_CAPABILITY" });
    }
    await expect(authorizeActor({ actor: actor(["ADMIN"]), action: "presence.history.admin_view" })).resolves.toMatchObject({ allowed: true });
    await expect(authorizeActor({ actor: actor(["ADMIN"]), action: "presence.correct.admin" })).resolves.toMatchObject({ allowed: true });
  });
});
