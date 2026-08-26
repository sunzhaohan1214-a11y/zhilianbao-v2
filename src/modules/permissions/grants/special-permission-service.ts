import type { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { effectiveAt } from "../effective";
import { PermissionError } from "../permission-errors";
import { bumpPermissionVersion } from "../permission-invalidation";
import { lockPermissionTarget } from "../repository/permission-repository";
import type { PermissionActor } from "../types";
import { writeGrantAudit, type GrantRequestContext } from "./grant-audit";

export const MANAGED_SPECIAL_PERMISSIONS = [
  "reimbursement.apply",
  "reimbursement.manage",
  "ai.service_manage",
] as const;

export type ManagedSpecialPermission = (typeof MANAGED_SPECIAL_PERMISSIONS)[number];

type SpecialPermissionMutationInput = {
  actor: PermissionActor;
  targetPersonId: string;
  permissionCode: ManagedSpecialPermission;
  reason: string;
  context?: GrantRequestContext;
};

type GrantSpecialPermissionInput = SpecialPermissionMutationInput & {
  effectiveAt?: Date;
  expiredAt?: Date;
};

function requireReason(reason: string): string {
  const normalized = reason.trim();
  if (!normalized) throw new PermissionError("PERMISSION_RULE_VIOLATION", "授权或撤销原因不能为空");
  return normalized.slice(0, 500);
}

function requireSpecialGrantAuthority(actor: PermissionActor, permissionCode: ManagedSpecialPermission): void {
  if (permissionCode === "reimbursement.apply") {
    if (!actor.hasGlobalOperational) {
      throw new PermissionError("FORBIDDEN_CAPABILITY", "只有管理员或超级管理员可管理往届报销申请权限");
    }
    return;
  }
  if (!actor.hasSystem) {
    throw new PermissionError("FORBIDDEN_SENSITIVE_PERMISSION", "此敏感权限只能由超级管理员管理");
  }
}

async function requireEligibleTarget(
  tx: Prisma.TransactionClient,
  personId: string,
  permissionCode: ManagedSpecialPermission,
  now: Date,
): Promise<void> {
  if (permissionCode !== "reimbursement.apply") return;
  const [alumniRole, membershipCount] = await Promise.all([
    tx.roleAssignment.findFirst({
      where: { personId, roleCode: "MEMBER_ALUMNI_PLATFORM", ...effectiveAt(now) },
      select: { id: true },
    }),
    tx.batchMembership.count({ where: { personId } }),
  ]);
  if (!alumniRole || membershipCount === 0) {
    throw new PermissionError(
      "PERMISSION_RULE_VIOLATION",
      "reimbursement.apply 仅可按人授予有效平台往届团员",
    );
  }
}

function overlapWhere(effective: Date, expired?: Date): Prisma.SpecialPermissionGrantWhereInput {
  return {
    ...(expired ? { effectiveAt: { lt: expired } } : {}),
    OR: [{ expiredAt: null }, { expiredAt: { gt: effective } }],
  };
}

export async function grantSpecialPermission(input: GrantSpecialPermissionInput) {
  requireSpecialGrantAuthority(input.actor, input.permissionCode);
  const reason = requireReason(input.reason);
  const startsAt = input.effectiveAt ?? new Date();
  if (input.expiredAt && input.expiredAt <= startsAt) {
    throw new PermissionError("PERMISSION_RULE_VIOLATION", "失效时间必须晚于生效时间");
  }
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    await lockPermissionTarget(tx, input.targetPersonId);
    await requireEligibleTarget(tx, input.targetPersonId, input.permissionCode, startsAt);
    const overlapping = await tx.specialPermissionGrant.findFirst({
      where: {
        personId: input.targetPersonId,
        permissionCode: input.permissionCode,
        ...overlapWhere(startsAt, input.expiredAt),
      },
      select: { id: true },
    });
    if (overlapping) {
      throw new PermissionError("PERMISSION_CONFLICT", "目标人员已存在重叠的敏感权限授权", {
        permissionCode: input.permissionCode,
      });
    }
    const grant = await tx.specialPermissionGrant.create({
      data: {
        personId: input.targetPersonId,
        permissionCode: input.permissionCode,
        effectiveAt: startsAt,
        expiredAt: input.expiredAt,
        reason,
        grantedByPersonId: input.actor.personId,
      },
    });
    await bumpPermissionVersion(input.targetPersonId, tx);
    await writeGrantAudit(tx, {
      actor: input.actor,
      actionCode: "SPECIAL_PERMISSION_GRANTED",
      entityType: "SPECIAL_PERMISSION_GRANT",
      entityId: grant.id,
      reason,
      after: {
        targetPersonId: input.targetPersonId,
        permissionCode: input.permissionCode,
        effectiveAt: startsAt.toISOString(),
        expiredAt: input.expiredAt?.toISOString() ?? "",
      },
      context: input.context,
    });
    return grant;
  });
}

export async function revokeSpecialPermission(input: SpecialPermissionMutationInput) {
  requireSpecialGrantAuthority(input.actor, input.permissionCode);
  const reason = requireReason(input.reason);
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    await lockPermissionTarget(tx, input.targetPersonId);
    const now = new Date();
    const revocableCandidates = await tx.specialPermissionGrant.findMany({
      where: {
        personId: input.targetPersonId,
        permissionCode: input.permissionCode,
        OR: [{ expiredAt: null }, { expiredAt: { gt: now } }],
      },
      select: { id: true, effectiveAt: true, expiredAt: true },
    });
    const current = revocableCandidates.filter(({ effectiveAt, expiredAt }) =>
      effectiveAt <= now && (expiredAt === null || expiredAt > now));
    const future = revocableCandidates.filter(({ effectiveAt, expiredAt }) =>
      effectiveAt > now && (expiredAt === null || expiredAt > effectiveAt));
    const revocable = [...current, ...future];
    if (revocable.length === 0) {
      throw new PermissionError("PERMISSION_CONFLICT", "目标人员没有可撤销的当前或未来敏感权限", {
        permissionCode: input.permissionCode,
      });
    }
    if (current.length > 0) {
      await tx.specialPermissionGrant.updateMany({
        where: { id: { in: current.map(({ id }) => id) } },
        data: { expiredAt: now },
      });
    }
    await Promise.all(future.map((grant) => tx.specialPermissionGrant.update({
      where: { id: grant.id },
      data: { expiredAt: grant.effectiveAt },
    })));
    await bumpPermissionVersion(input.targetPersonId, tx);
    await writeGrantAudit(tx, {
      actor: input.actor,
      actionCode: "SPECIAL_PERMISSION_REVOKED",
      entityType: "SPECIAL_PERMISSION_GRANT",
      entityId: revocable[0].id,
      reason,
      before: {
        targetPersonId: input.targetPersonId,
        permissionCode: input.permissionCode,
        currentGrantIds: current.map(({ id }) => id),
        futureGrantIds: future.map(({ id }) => id),
      },
      after: {
        revokedAt: now.toISOString(),
        currentGrantsExpiredAtRevokeTime: current.map(({ id }) => ({
          id,
          expiredAt: now.toISOString(),
        })),
        futureGrantsCanceledAtEffectiveTime: future.map(({ id, effectiveAt }) => ({
          id,
          expiredAt: effectiveAt.toISOString(),
        })),
      },
      context: input.context,
    });
    return {
      revokedIds: revocable.map(({ id }) => id),
      currentGrantIds: current.map(({ id }) => id),
      futureGrantIds: future.map(({ id }) => id),
      expiredAt: now,
    };
  });
}

type NamedGrantInput = Omit<GrantSpecialPermissionInput, "permissionCode">;
type NamedRevokeInput = Omit<SpecialPermissionMutationInput, "permissionCode">;

export const grantReimbursementApply = (input: NamedGrantInput) =>
  grantSpecialPermission({ ...input, permissionCode: "reimbursement.apply" });
export const revokeReimbursementApply = (input: NamedRevokeInput) =>
  revokeSpecialPermission({ ...input, permissionCode: "reimbursement.apply" });
export const grantReimbursementManage = (input: NamedGrantInput) =>
  grantSpecialPermission({ ...input, permissionCode: "reimbursement.manage" });
export const revokeReimbursementManage = (input: NamedRevokeInput) =>
  revokeSpecialPermission({ ...input, permissionCode: "reimbursement.manage" });
