import { describe, expect, it } from "vitest";
import type { RoleCode } from "@/generated/prisma/client";
import {
  homeRoleLabels,
  isOutcomeFillTodoActionable,
  resolveHomeTodoPriority,
  sortHomeTodos,
  staleCutoffAt,
} from "@/modules/home";
import { resolveCapabilities, type PermissionActor } from "@/modules/permissions";
import { summarizeHomeTripPlaces } from "@/modules/trip/trip-service";

function actor(roles: RoleCode[]): PermissionActor {
  return {
    personId: "person",
    accountId: "account",
    accountStatus: "NORMAL",
    permissionVersion: BigInt(1),
    effectiveRoles: roles,
    capabilities: resolveCapabilities(roles, new Set()),
    specialPermissions: new Set(),
    selfPersonId: "person",
    townshipAreaIds: [],
    departmentAreaIds: [],
    hasGlobalPublished: true,
    hasGlobalOperational: roles.includes("ADMIN") || roles.includes("SUPER_ADMIN"),
    hasSystem: roles.includes("SUPER_ADMIN"),
    currentBatchMember: roles.includes("MEMBER_CURRENT"),
    configurationIssues: [],
  };
}

describe("A-M1-008 home contracts", () => {
  it("shows team labels only for effective group-leader and minister roles", () => {
    expect(homeRoleLabels(actor(["GROUP_LEADER", "MEMBER_CURRENT"]))).toEqual(["团长"]);
    expect(homeRoleLabels(actor(["MINISTER", "GROUP_LEADER", "MEMBER_CURRENT"]))).toEqual(["团长", "部长"]);
    expect(homeRoleLabels(actor(["ADMIN"]))).toEqual([]);
  });

  it("uses the Shanghai natural-day boundary for more than 30 days", () => {
    expect(staleCutoffAt(new Date("2026-08-28T15:59:59.999Z")).toISOString()).toBe("2026-07-28T16:00:00.000Z");
    expect(staleCutoffAt(new Date("2026-08-28T16:00:00.000Z")).toISOString()).toBe("2026-07-29T16:00:00.000Z");
  });

  it("derives urgency without mutating todos and sorts urgently, then by due time", () => {
    const urgent = resolveHomeTodoPriority({
      id: "urgent", type: "HELP_PROCESS", label: "处理办事求助", module: "help", actionUrl: "/help/urgent",
      dueAt: new Date("2026-09-03T00:00:00Z"), createdAt: new Date("2026-08-03T00:00:00Z"), helpUrgency: "URGENT",
    });
    const sooner = resolveHomeTodoPriority({
      id: "sooner", type: "TRIP_RESULT", label: "补充行程结果", module: "trip", actionUrl: "/trips/sooner",
      dueAt: new Date("2026-08-29T00:00:00Z"), createdAt: new Date("2026-08-04T00:00:00Z"),
    });
    const later = resolveHomeTodoPriority({
      id: "later", type: "DEMAND_REVIEW", label: "审核正式需求", module: "demand", actionUrl: "/demands/later",
      dueAt: new Date("2026-08-30T00:00:00Z"), createdAt: new Date("2026-08-02T00:00:00Z"),
    });

    expect(sortHomeTodos([later, sooner, urgent]).map(({ id }) => id)).toEqual(["urgent", "sooner", "later"]);
    expect(urgent.priority).toBe("HIGH");
  });

  it("summarizes one, two, and many trip places without duplicating shared trips", () => {
    expect(summarizeHomeTripPlaces([{ locationName: "开发区", enterprise: null }])).toBe("开发区");
    expect(summarizeHomeTripPlaces([
      { locationName: "A", enterprise: { name: "甲企业" } },
      { locationName: "B", enterprise: { name: "乙企业" } },
    ])).toBe("走访 甲企业、乙企业");
    expect(summarizeHomeTripPlaces([
      { locationName: "A", enterprise: { name: "甲企业" } },
      { locationName: "B", enterprise: { name: "乙企业" } },
      { locationName: "C", enterprise: { name: "丙企业" } },
    ])).toBe("走访 甲企业、乙企业 等 3 家企业");
  });

  it.each([
    [null, true],
    ["DRAFT", true],
    ["PENDING_REVIEW", false],
    ["RETURNED", false],
  ] as const)("shows OUTCOME_FILL only for no active round or an active DRAFT round (%s)", (activeRoundReviewStatus, expected) => {
    expect(isOutcomeFillTodoActionable({
      demandStatus: "COMPLETED",
      planStatus: "IN_PROGRESS",
      dueAt: new Date("2026-08-28T00:00:00.000Z"),
      now: new Date("2026-08-28T12:00:00.000Z"),
      activeRoundReviewStatus,
      responsibleTownship: true,
    })).toBe(expected);
  });
});
