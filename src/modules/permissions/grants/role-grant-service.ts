import type { Prisma, RoleCode } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { effectiveAt } from "../effective";
import { PermissionError } from "../permission-errors";
import { bumpPermissionVersion } from "../permission-invalidation";
import { lockPermissionTarget } from "../repository/permission-repository";
import type { PermissionActor } from "../types";
import { writeGrantAudit, type GrantRequestContext } from "./grant-audit";

export const HIGH_PRIVILEGE_ROLES = [
  "ADMIN",
  "SUPER_ADMIN",
  "GROUP_LEADER",
  "MINISTER",
  "LEADER_STAGE2",
] as const satisfies readonly RoleCode[];

type RoleMutationInput = {
  actor: PermissionActor;
  targetPersonId: string;
  roleCode: RoleCode;
  reason: string;
  context?: GrantRequestContext;
};

type GrantRoleInput = RoleMutationInput & {
  effectiveAt?: Date;
  expiredAt?: Date;
};

function requireReason(reason: string): string {
  const normalized = reason.trim();
  if (!normalized) throw new PermissionError("PERMISSION_RULE_VIOLATION", "授权或撤销原因不能为空");
  return normalized.slice(0, 500);
}
function requireRoleGrantAuthority(actor: PermissionActor, roleCode: RoleCode): void {
  if ((HIGH_PRIVILEGE_ROLES as readonly RoleCode[]).includes(roleCode)) {
    if (!actor.hasSystem) {
      throw new PermissionError("FORBIDDEN_SENSITIVE_PERMISSION", "高权限角色只能由超级管理员变更");
    }
    return;
  }
  if (!actor.hasGlobalOperational) {
    throw new PermissionError("FORBIDDEN_CAPABILITY", "当前账号不能管理角色授权");
  }
}

function overlapWhere(effective: Date, expired?: Date): Prisma.RoleAssignmentWhereInput {
  return {
    ...(expired ? { effectiveAt: { lt: expired } } : {}),
    OR: [{ expiredAt: null }, { expiredAt: { gt: effective } }],
  };
}

export async function grantRole(input: GrantRoleInput) {
  requireRoleGrantAuthority(input.actor, input.roleCode);
  const reason = requireReason(input.reason);
  const startsAt = input.effectiveAt ?? new Date();
  if (input.expiredAt && input.expiredAt <= startsAt) {
    throw new PermissionError("PERMISSION_RULE_VIOLATION", "失效时间必须晚于生效时间");
  }
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    await lockPermissionTarget(tx, input.targetPersonId);
    const overlapping = await tx.roleAssignment.findFirst({
      where: {
        personId: input.targetPersonId,
        roleCode: input.roleCode,
        ...overlapWhere(startsAt, input.expiredAt),
      },
      select: { id: true },
    });
    if (overlapping) {
      throw new PermissionError("PERMISSION_CONFLICT", "目标人员已存在重叠的角色授权", {
        roleCode: input.roleCode,
      });
    }
    const assignment = await tx.roleAssignment.create({
      data: {
        personId: input.targetPersonId,
        roleCode: input.roleCode,
        effectiveAt: startsAt,
        expiredAt: input.expiredAt,
        grantedByPersonId: input.actor.personId,
        reason,
      },
    });
    await bumpPermissionVersion(input.targetPersonId, tx);
    await writeGrantAudit(tx, {
      actor: input.actor,
      actionCode: "ROLE_GRANTED",
      entityType: "ROLE_ASSIGNMENT",
      entityId: assignment.id,
      reason,
      after: {
        targetPersonId: input.targetPersonId,
        roleCode: input.roleCode,
        effectiveAt: startsAt.toISOString(),
        expiredAt: input.expiredAt?.toISOString() ?? null,
      },
      context: input.context,
    });
    return assignment;
  });
}

export async function revokeRole(input: RoleMutationInput) {
  requireRoleGrantAuthority(input.actor, input.roleCode);
  const reason = requireReason(input.reason);
  const now = new Date();
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    await lockPermissionTarget(tx, input.targetPersonId);
    const active = await tx.roleAssignment.findMany({
      where: { personId: input.targetPersonId, roleCode: input.roleCode, ...effectiveAt(now) },
      select: { id: true, effectiveAt: true, expiredAt: true },
    });
    if (active.length === 0) {
      throw new PermissionError("PERMISSION_CONFLICT", "目标人员没有可撤销的活动角色授权", {
        roleCode: input.roleCode,
      });
    }
    await tx.roleAssignment.updateMany({
      where: { id: { in: active.map(({ id }) => id) } },
      data: { expiredAt: now },
    });
    await bumpPermissionVersion(input.targetPersonId, tx);
    await writeGrantAudit(tx, {
      actor: input.actor,
      actionCode: "ROLE_REVOKED",
      entityType: "ROLE_ASSIGNMENT",
      entityId: active[0].id,
      reason,
      before: { targetPersonId: input.targetPersonId, roleCode: input.roleCode, activeGrantIds: active.map(({ id }) => id) },
      after: { expiredAt: now.toISOString() },
      context: input.context,
    });
    return { revokedIds: active.map(({ id }) => id), expiredAt: now };
  });
}
