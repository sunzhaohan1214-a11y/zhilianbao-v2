import { getPrismaClient } from "@/lib/db/prisma";
import { AuthError } from "./errors";
import { hashPassword, initialPasswordFromPhone } from "./password/password";
import { normalizePhone } from "./phone";
import { lockAccount, writeAudit } from "./repository/auth-repository";

function isUniqueConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export async function provisionAccount(input: { personId: string; phone: string }) {
  const phone = normalizePhone(input.phone);
  const passwordHash = await hashPassword(initialPasswordFromPhone(phone));
  try {
    return await getPrismaClient().$transaction(async (tx) => {
      const account = await tx.account.create({
        data: { personId: input.personId, phone, passwordHash, status: "PENDING_ENABLE" },
      });
      await tx.stateTransitionHistory.create({ data: { entityType: "ACCOUNT", entityId: account.id, toState: "PENDING_ENABLE", actionCode: "ACCOUNT_PROVISIONED" } });
      await writeAudit({ actionCode: "ACCOUNT_PROVISIONED", accountId: account.id, personId: input.personId, entityId: account.id }, tx);
      return account;
    });
  } catch (error) {
    if (isUniqueConflict(error)) throw new AuthError("ACCOUNT_CONFLICT", "人员或手机号已有账号", 409);
    throw error;
  }
}

export async function enableAccount(accountId: string) {
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    await lockAccount(tx, accountId);
    const account = await tx.account.findUniqueOrThrow({ where: { id: accountId } });
    if (account.status !== "PENDING_ENABLE") throw new AuthError("ACCOUNT_STATE_CONFLICT", "账号状态不允许启用", 409);
    const nextStatus = account.firstPasswordChangedAt ? "NORMAL" : "UNACTIVATED";
    const updated = await tx.account.update({
      where: { id: accountId },
      data: { status: nextStatus },
    });
    await tx.stateTransitionHistory.create({ data: { entityType: "ACCOUNT", entityId: accountId, fromState: account.status, toState: nextStatus, actionCode: "ACCOUNT_ENABLED" } });
    await writeAudit({ actionCode: "ACCOUNT_ENABLED", accountId, personId: account.personId, entityId: accountId }, tx);
    return updated;
  });
}

export async function disableAccount(accountId: string) {
  const now = new Date();
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    await lockAccount(tx, accountId);
    const account = await tx.account.findUniqueOrThrow({ where: { id: accountId } });
    const updated = await tx.account.update({ where: { id: accountId }, data: { status: "DISABLED" } });
    await tx.session.updateMany({ where: { accountId, revokedAt: null }, data: { revokedAt: now } });
    await tx.stateTransitionHistory.create({ data: { entityType: "ACCOUNT", entityId: accountId, fromState: account.status, toState: "DISABLED", actionCode: "ACCOUNT_DISABLED" } });
    await writeAudit({ actionCode: "ACCOUNT_DISABLED", accountId, personId: account.personId, entityId: accountId }, tx);
    return updated;
  });
}

export async function restoreAccountToPendingEnable(accountId: string) {
  return getPrismaClient().$transaction(async (tx) => {
    await lockAccount(tx, accountId);
    const account = await tx.account.findUniqueOrThrow({ where: { id: accountId } });
    if (account.status !== "DISABLED") throw new AuthError("ACCOUNT_STATE_CONFLICT", "账号状态不允许恢复", 409);
    const updated = await tx.account.update({ where: { id: accountId }, data: { status: "PENDING_ENABLE" } });
    await tx.stateTransitionHistory.create({ data: { entityType: "ACCOUNT", entityId: accountId, fromState: "DISABLED", toState: "PENDING_ENABLE", actionCode: "ACCOUNT_RESTORED" } });
    await writeAudit({ actionCode: "ACCOUNT_RESTORED", accountId, personId: account.personId, entityId: accountId }, tx);
    return updated;
  });
}

export async function resetPasswordToInitial(accountId: string) {
  const prisma = getPrismaClient();
  const accountSnapshot = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
  const phoneSnapshot = accountSnapshot.phone;
  const passwordHash = await hashPassword(initialPasswordFromPhone(phoneSnapshot));
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    await lockAccount(tx, accountId);
    const account = await tx.account.findUniqueOrThrow({ where: { id: accountId } });
    if (account.phone !== phoneSnapshot) {
      throw new AuthError("ACCOUNT_PHONE_CHANGED", "手机号已发生变化，请重试密码重置", 409);
    }
    const updated = await tx.account.update({
      where: { id: accountId },
      data: { passwordHash, forcePasswordChange: true },
    });
    await tx.session.updateMany({ where: { accountId, revokedAt: null }, data: { revokedAt: now } });
    await writeAudit({ actionCode: "AUTH_PASSWORD_RESET", accountId, personId: account.personId, entityId: accountId }, tx);
    return updated;
  });
}
