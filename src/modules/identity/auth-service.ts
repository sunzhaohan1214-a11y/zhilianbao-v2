import { getPrismaClient } from "@/lib/db/prisma";
import { AuthError } from "./errors";
import { hashPassword, validateNewPassword, verifyDummyPassword, verifyPassword } from "./password/password";
import { normalizePhone } from "./phone";
import type { AuthRequestContext } from "./request-context";
import {
  checkLoginRateLimit,
  issueSessionAtomically,
  issueSessionInTransaction,
  lockAccount,
  recordLoginFailure,
  resetSuccessfulLoginRateLimits,
  writeAudit,
} from "./repository/auth-repository";
import type { CurrentSession } from "./session-service";
import { annotateSafeErrorStage } from "@/lib/logging/safe-error";

function nextStep(account: { status: string; forcePasswordChange: boolean }) {
  if (account.status === "UNACTIVATED") return "ACTIVATE" as const;
  if (account.forcePasswordChange) return "CHANGE_PASSWORD" as const;
  return "HOME" as const;
}

export async function login(input: { phone: string; password: string }, context: AuthRequestContext) {
  let stage = "rate_limit_check";
  try {
  const phone = normalizePhone(input.phone);
  const rate = await checkLoginRateLimit({ phone, ip: context.ip, deviceId: context.deviceId });
  if (rate.limited) {
    if (rate.shouldAudit) await writeAudit({
      actionCode: "AUTH_LOGIN_RATE_LIMITED",
      after: { dimensions: rate.dimensions },
      ip: context.ip,
      device: context.deviceId,
      requestId: context.requestId,
    });
    throw new AuthError("AUTH_RATE_LIMITED", "请求过于频繁，请稍后再试", 429);
  }

  stage = "account_lookup";
  const prisma = getPrismaClient();
  const account = await prisma.account.findUnique({ where: { phone }, include: { person: true } });
  stage = "password_verify";
  const validPassword = account
    ? await verifyPassword(account.passwordHash, input.password)
    : (await verifyDummyPassword(input.password), false);
  if (!account || !validPassword) {
    await recordLoginFailure({ phone, ip: context.ip, deviceId: context.deviceId });
    await writeAudit({
      actionCode: "AUTH_LOGIN_FAILED",
      accountId: account?.id,
      personId: account?.personId,
      entityId: account?.id,
      after: { reason: "INVALID_CREDENTIALS" },
      ip: context.ip,
      device: context.deviceId,
      requestId: context.requestId,
    });
    throw new AuthError("INVALID_CREDENTIALS", "账号或密码错误", 401);
  }
  if (account.status === "PENDING_ENABLE" || account.status === "DISABLED") {
    await writeAudit({
      actionCode: "AUTH_LOGIN_FAILED",
      accountId: account.id,
      personId: account.personId,
      entityId: account.id,
      after: { reason: "ACCOUNT_UNAVAILABLE" },
      ip: context.ip,
      device: context.deviceId,
      requestId: context.requestId,
    });
    throw new AuthError("ACCOUNT_UNAVAILABLE", "当前账号暂不可登录，请联系管理员", 403);
  }
  if (account.status === "NORMAL" && !account.confidentialityConfirmedAt) {
    throw new AuthError("ACCOUNT_INCONSISTENT", "当前账号暂不可登录，请联系管理员", 403);
  }

  stage = "session_issue";
  const issued = await issueSessionAtomically({
    accountId: account.id,
    deviceId: context.deviceId,
    deviceName: context.deviceName,
    userAgent: context.userAgent,
    ip: context.ip,
  });
  stage = "last_login_update";
  await prisma.account.update({ where: { id: account.id }, data: { lastLoginAt: new Date() } });
  stage = "rate_limit_reset";
  await resetSuccessfulLoginRateLimits({ phone, deviceId: context.deviceId });
  stage = "audit_write";
  await writeAudit({
    actionCode: "AUTH_LOGIN_SUCCESS",
    accountId: account.id,
    personId: account.personId,
    entityId: account.id,
    after: { sessionId: issued.session.id, nextStep: nextStep(account) },
    ip: context.ip,
    device: context.deviceId,
    requestId: context.requestId,
  });
  stage = "complete";
  return { ...issued, nextStep: nextStep(account) };
  } catch (error) {
    annotateSafeErrorStage(error, stage);
    throw error;
  }
}

export async function completeFirstActivation(input: {
  current: CurrentSession;
  newPassword: string;
  confidentialityConfirm: boolean;
  context: AuthRequestContext;
}) {
  if (input.current.accountStatus !== "UNACTIVATED") throw new AuthError("ACCOUNT_STATE_CONFLICT", "账号当前不需要首次激活", 409);
  if (!input.confidentialityConfirm) throw new AuthError("CONFIDENTIALITY_REQUIRED", "请确认内部使用及信息保密说明", 422);
  validateNewPassword(input.newPassword, input.current.phone);
  const passwordHash = await hashPassword(input.newPassword);
  const now = new Date();
  return getPrismaClient().$transaction(async (tx) => {
    await lockAccount(tx, input.current.accountId);
    const account = await tx.account.findUniqueOrThrow({ where: { id: input.current.accountId } });
    if (account.status !== "UNACTIVATED") throw new AuthError("ACCOUNT_STATE_CONFLICT", "账号状态已发生变化", 409);
    await tx.account.update({
      where: { id: account.id },
      data: {
        passwordHash,
        firstPasswordChangedAt: now,
        confidentialityConfirmedAt: now,
        status: "NORMAL",
        forcePasswordChange: false,
      },
    });
    await tx.stateTransitionHistory.create({
      data: {
        entityType: "ACCOUNT",
        entityId: account.id,
        fromState: "UNACTIVATED",
        toState: "NORMAL",
        actionCode: "ACCOUNT_FIRST_ACTIVATION_COMPLETED",
        actorPersonId: account.personId,
        requestId: input.context.requestId,
      },
    });
    await tx.session.updateMany({ where: { accountId: account.id, revokedAt: null }, data: { revokedAt: now } });
    const issued = await issueSessionInTransaction(tx, {
      accountId: account.id,
      deviceId: input.context.deviceId,
      deviceName: input.context.deviceName,
      userAgent: input.context.userAgent,
      ip: input.context.ip,
    }, now);
    await writeAudit({ actionCode: "AUTH_PASSWORD_CHANGED", accountId: account.id, personId: account.personId, entityId: account.id, after: { firstActivation: true }, ip: input.context.ip, device: input.context.deviceId, requestId: input.context.requestId }, tx);
    return issued;
  });
}

export async function changePassword(input: {
  current: CurrentSession;
  oldPassword?: string;
  newPassword: string;
  context: AuthRequestContext;
}) {
  if (input.current.accountStatus !== "NORMAL") throw new AuthError("ACCOUNT_STATE_CONFLICT", "账号状态不允许修改密码", 409);
  validateNewPassword(input.newPassword, input.current.phone);
  const prisma = getPrismaClient();
  const passwordHash = await hashPassword(input.newPassword);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    await lockAccount(tx, input.current.accountId);
    const account = await tx.account.findUniqueOrThrow({ where: { id: input.current.accountId } });
    if (account.status !== "NORMAL") throw new AuthError("ACCOUNT_STATE_CONFLICT", "账号状态已发生变化", 409);
    if (!account.forcePasswordChange && (!input.oldPassword || !(await verifyPassword(account.passwordHash, input.oldPassword)))) {
      throw new AuthError("OLD_PASSWORD_INVALID", "原密码错误", 422);
    }
    await tx.account.update({ where: { id: account.id }, data: { passwordHash, forcePasswordChange: false } });
    await tx.session.updateMany({ where: { accountId: account.id, revokedAt: null }, data: { revokedAt: now } });
    const issued = await issueSessionInTransaction(tx, {
      accountId: account.id,
      deviceId: input.context.deviceId,
      deviceName: input.context.deviceName,
      userAgent: input.context.userAgent,
      ip: input.context.ip,
    }, now);
    await writeAudit({ actionCode: "AUTH_PASSWORD_CHANGED", accountId: account.id, personId: account.personId, entityId: account.id, after: { forced: account.forcePasswordChange }, ip: input.context.ip, device: input.context.deviceId, requestId: input.context.requestId }, tx);
    return issued;
  });
}

export async function logoutCurrent(current: CurrentSession, context: AuthRequestContext): Promise<void> {
  await getPrismaClient().session.updateMany({ where: { id: current.sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  await writeAudit({ actionCode: "AUTH_LOGOUT", accountId: current.accountId, personId: current.personId, entityId: current.sessionId, ip: context.ip, device: context.deviceId, requestId: context.requestId });
}

export async function logoutAll(current: CurrentSession, context: AuthRequestContext): Promise<void> {
  await getPrismaClient().session.updateMany({ where: { accountId: current.accountId, revokedAt: null }, data: { revokedAt: new Date() } });
  await writeAudit({ actionCode: "AUTH_LOGOUT_ALL", accountId: current.accountId, personId: current.personId, entityId: current.accountId, ip: context.ip, device: context.deviceId, requestId: context.requestId });
}

export async function listOwnSessions(current: CurrentSession) {
  const now = new Date();
  const sessions = await getPrismaClient().session.findMany({
    where: { accountId: current.accountId, revokedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
    select: { id: true, deviceName: true, createdAt: true, expiresAt: true },
  });
  return sessions.map((session) => ({
    sessionId: session.id,
    deviceName: session.deviceName ?? "未知设备",
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    isCurrent: session.id === current.sessionId,
  }));
}

export async function revokeOwnSession(current: CurrentSession, sessionId: string): Promise<{ revokedCurrent: boolean }> {
  const result = await getPrismaClient().session.updateMany({
    where: { id: sessionId, accountId: current.accountId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (result.count === 0) throw new AuthError("SESSION_NOT_FOUND", "设备会话不存在", 404);
  return { revokedCurrent: sessionId === current.sessionId };
}
