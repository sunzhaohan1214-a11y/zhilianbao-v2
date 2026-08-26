import { createHash, randomUUID } from "node:crypto";
import type { AuthRateLimitDimension, Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { createSessionToken, hashSessionToken } from "../session-token";
import { AuthError } from "../errors";

export type TransactionClient = Prisma.TransactionClient;

export type SessionIssueInput = {
  accountId: string;
  deviceId: string;
  deviceName: string;
  userAgent: string;
  ip: string;
};

const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export async function lockAccount(tx: TransactionClient, accountId: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM accounts WHERE id = ${accountId} FOR UPDATE
  `;
  if (rows.length !== 1) throw new Error("Account disappeared while acquiring issuance lock");
}

export async function issueSessionInTransaction(
  tx: TransactionClient,
  input: SessionIssueInput,
  now = new Date(),
) {
  const account = await tx.account.findUniqueOrThrow({ where: { id: input.accountId } });
  if (account.status !== "UNACTIVATED" && account.status !== "NORMAL") {
    throw new AuthError("ACCOUNT_UNAVAILABLE", "当前账号暂不可登录，请联系管理员", 403);
  }
  if (account.status === "NORMAL" && !account.confidentialityConfirmedAt) {
    throw new AuthError("ACCOUNT_INCONSISTENT", "当前账号暂不可登录，请联系管理员", 403);
  }
  const rawToken = createSessionToken();
  const tokenHash = hashSessionToken(rawToken);

  await tx.session.updateMany({
    where: {
      accountId: input.accountId,
      deviceId: input.deviceId,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    data: { revokedAt: now },
  });

  const active = await tx.session.findMany({
    where: { accountId: input.accountId, revokedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "asc" },
    select: { deviceId: true, createdAt: true },
  });
  const deviceOldest = new Map<string, Date>();
  for (const session of active) {
    const previous = deviceOldest.get(session.deviceId);
    if (!previous || session.createdAt < previous) deviceOldest.set(session.deviceId, session.createdAt);
  }
  if (deviceOldest.size >= 2) {
    const oldestDevice = [...deviceOldest.entries()].sort((a, b) => a[1].getTime() - b[1].getTime())[0][0];
    await tx.session.updateMany({
      where: { accountId: input.accountId, deviceId: oldestDevice, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  const session = await tx.session.create({
    data: {
      accountId: input.accountId,
      tokenHash,
      deviceId: input.deviceId,
      deviceName: input.deviceName.slice(0, 100),
      userAgent: input.userAgent.slice(0, 500),
      ipLast: input.ip.slice(0, 45),
      permissionVersion: account.permissionVersion,
      expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS),
    },
  });
  return { rawToken, session };
}

export async function issueSessionAtomically(input: SessionIssueInput) {
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    await lockAccount(tx, input.accountId);
    return issueSessionInTransaction(tx, input);
  });
}

export async function writeAudit(input: {
  actionCode: string;
  accountId?: string;
  personId?: string;
  entityId?: string;
  after?: Record<string, unknown>;
  ip?: string;
  device?: string;
  requestId?: string;
}, tx?: TransactionClient): Promise<void> {
  const db = tx ?? getPrismaClient();
  await db.auditLog.create({
    data: {
      actionCode: input.actionCode,
      entityType: "AUTH",
      entityId: input.entityId,
      actorAccountId: input.accountId,
      actorPersonId: input.personId,
      afterJson: input.after as Prisma.InputJsonValue | undefined,
      ip: input.ip?.slice(0, 45),
      device: input.device?.slice(0, 255),
      requestId: input.requestId?.slice(0, 100),
    },
  });
}

type RatePolicy = { dimension: AuthRateLimitDimension; value: string; maximum: number };

function rateLimitSecret(): string {
  const configured = process.env.AUTH_RATE_LIMIT_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_RATE_LIMIT_SECRET is required in production");
  return "local-test-only-rate-limit-secret";
}

function rateKey(dimension: AuthRateLimitDimension, value: string): string {
  return createHash("sha256").update(`${rateLimitSecret()}:${dimension}:${value}`).digest("hex");
}

export async function consumeLoginRateLimit(input: { phone: string; ip: string; deviceId: string }) {
  const policies: RatePolicy[] = [
    { dimension: "PHONE", value: input.phone, maximum: 5 },
    { dimension: "IP", value: input.ip, maximum: 30 },
    { dimension: "DEVICE", value: input.deviceId, maximum: 10 },
  ];
  const now = new Date();
  const windowMs = 15 * 60 * 1000;
  const prisma = getPrismaClient();

  return prisma.$transaction(async (tx) => {
    let limited = false;
    let shouldAudit = false;
    for (const policy of policies) {
      const keyHash = rateKey(policy.dimension, policy.value);
      await tx.$executeRaw`
        INSERT INTO auth_rate_limit_buckets
          (id, dimension, key_hash, window_start, attempt_count, updated_at)
        VALUES
          (${randomUUID()}, ${policy.dimension}, ${keyHash}, ${now}, 0, ${now})
        ON DUPLICATE KEY UPDATE updated_at = updated_at
      `;
      const [bucket] = await tx.$queryRaw<Array<{
        id: string;
        windowStart: Date;
        attemptCount: number;
        blockedUntil: Date | null;
        lastLoggedAt: Date | null;
      }>>`
        SELECT id, window_start AS windowStart, attempt_count AS attemptCount,
               blocked_until AS blockedUntil, last_logged_at AS lastLoggedAt
        FROM auth_rate_limit_buckets
        WHERE dimension = ${policy.dimension} AND key_hash = ${keyHash}
        FOR UPDATE
      `;

      if (bucket.blockedUntil && bucket.blockedUntil > now) {
        limited = true;
        if (!bucket.lastLoggedAt || now.getTime() - bucket.lastLoggedAt.getTime() >= 5 * 60 * 1000) {
          shouldAudit = true;
          await tx.authRateLimitBucket.update({ where: { id: bucket.id }, data: { lastLoggedAt: now } });
        }
        continue;
      }

      const expiredWindow = now.getTime() - bucket.windowStart.getTime() >= windowMs;
      const nextCount = expiredWindow ? 1 : bucket.attemptCount + 1;
      const blockedUntil = nextCount > policy.maximum ? new Date(now.getTime() + windowMs) : null;
      if (blockedUntil) {
        limited = true;
        shouldAudit = true;
      }
      await tx.authRateLimitBucket.update({
        where: { id: bucket.id },
        data: {
          windowStart: expiredWindow ? now : bucket.windowStart,
          attemptCount: nextCount,
          blockedUntil,
          lastLoggedAt: blockedUntil ? now : bucket.lastLoggedAt,
        },
      });
    }
    return { limited, shouldAudit };
  });
}

export async function resetSuccessfulLoginRateLimits(input: { phone: string; deviceId: string }): Promise<void> {
  const now = new Date();
  const keys = [
    { dimension: "PHONE" as const, keyHash: rateKey("PHONE", input.phone) },
    { dimension: "DEVICE" as const, keyHash: rateKey("DEVICE", input.deviceId) },
  ];
  const prisma = getPrismaClient();
  await Promise.all(keys.map((key) => prisma.authRateLimitBucket.updateMany({
    where: key,
    data: { attemptCount: 0, windowStart: now, blockedUntil: null },
  })));
}
