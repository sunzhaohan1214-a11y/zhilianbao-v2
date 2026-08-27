import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getPrismaClient } from "@/lib/db/prisma";
import { disableAccount, enableAccount, provisionAccount, resetPasswordToInitial, restoreAccountToPendingEnable } from "@/modules/identity/account-service";
import { changePassword, completeFirstActivation, listOwnSessions, login, logoutAll, logoutCurrent, revokeOwnSession } from "@/modules/identity/auth-service";
import { hashPassword, initialPasswordFromPhone, verifyPassword } from "@/modules/identity/password/password";
import type { AuthRequestContext } from "@/modules/identity/request-context";
import { lockAccount } from "@/modules/identity/repository/auth-repository";
import { getCurrentSessionByToken } from "@/modules/identity/session-service";

const prisma = getPrismaClient();
let ipCounter = 10;

function phone(): string {
  return `139${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
}

function context(deviceId: string = randomUUID()): AuthRequestContext {
  ipCounter += 1;
  return {
    ip: `10.20.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`,
    userAgent: "Vitest Auth Integration",
    deviceId,
    deviceName: `Test Device ${deviceId.slice(0, 6)}`,
    requestId: randomUUID(),
  };
}

async function person(name: string) {
  return prisma.person.create({ data: { name: `${name}-${randomUUID()}` } });
}

async function normalAccount() {
  const owner = await person("normal");
  const accountPhone = phone();
  const account = await prisma.account.create({
    data: {
      personId: owner.id,
      phone: accountPhone,
      passwordHash: await hashPassword("normal-password"),
      status: "NORMAL",
      firstPasswordChangedAt: new Date(),
      confidentialityConfirmedAt: new Date(),
    },
  });
  return { owner, account, phone: accountPhone, password: "normal-password" };
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe("M0-003 account lifecycle and password integration", () => {
  it("provisions, activates, disables, restores, and re-enables without plaintext passwords", async () => {
    const owner = await person("lifecycle");
    const accountPhone = phone();
    const provisioned = await provisionAccount({ personId: owner.id, phone: accountPhone });
    expect(provisioned.status).toBe("PENDING_ENABLE");
    expect(provisioned.passwordHash).not.toContain(initialPasswordFromPhone(accountPhone));
    expect(await verifyPassword(provisioned.passwordHash, initialPasswordFromPhone(accountPhone))).toBe(true);

    await expect(login({ phone: accountPhone, password: initialPasswordFromPhone(accountPhone) }, context())).rejects.toMatchObject({ code: "ACCOUNT_UNAVAILABLE" });
    expect((await enableAccount(provisioned.id)).status).toBe("UNACTIVATED");

    const firstContext = context("lifecycle-device");
    const restrictedLogin = await login({ phone: accountPhone, password: initialPasswordFromPhone(accountPhone) }, firstContext);
    const restricted = await getCurrentSessionByToken(restrictedLogin.rawToken);
    expect(restricted?.accountStatus).toBe("UNACTIVATED");
    await expect(completeFirstActivation({ current: restricted!, newPassword: "short", confidentialityConfirm: true, context: firstContext })).rejects.toMatchObject({ code: "PASSWORD_TOO_SHORT" });
    await expect(completeFirstActivation({ current: restricted!, newPassword: accountPhone.slice(-8), confidentialityConfirm: true, context: firstContext })).rejects.toMatchObject({ code: "PASSWORD_MATCHES_PHONE" });
    const activated = await completeFirstActivation({ current: restricted!, newPassword: "activated-password", confidentialityConfirm: true, context: firstContext });
    expect(await getCurrentSessionByToken(restrictedLogin.rawToken)).toBeNull();
    expect((await getCurrentSessionByToken(activated.rawToken))?.accountStatus).toBe("NORMAL");

    await disableAccount(provisioned.id);
    expect(await getCurrentSessionByToken(activated.rawToken)).toBeNull();
    expect((await restoreAccountToPendingEnable(provisioned.id)).status).toBe("PENDING_ENABLE");
    expect((await enableAccount(provisioned.id)).status).toBe("NORMAL");
  });

  it("resets to the initial password, forces change, and revokes every old session", async () => {
    const fixture = await normalAccount();
    const first = await login({ phone: fixture.phone, password: fixture.password }, context("reset-a"));
    const second = await login({ phone: fixture.phone, password: fixture.password }, context("reset-b"));
    const reset = await resetPasswordToInitial(fixture.account.id);
    expect(reset.forcePasswordChange).toBe(true);
    expect(await verifyPassword(reset.passwordHash, initialPasswordFromPhone(fixture.phone))).toBe(true);
    expect(await getCurrentSessionByToken(first.rawToken)).toBeNull();
    expect(await getCurrentSessionByToken(second.rawToken)).toBeNull();

    const changeContext = context("reset-a");
    const temporary = await login({ phone: fixture.phone, password: initialPasswordFromPhone(fixture.phone) }, changeContext);
    const restricted = await getCurrentSessionByToken(temporary.rawToken);
    expect(restricted?.forcePasswordChange).toBe(true);
    const changed = await changePassword({ current: restricted!, newPassword: "reset-complete-password", context: changeContext });
    expect(await getCurrentSessionByToken(temporary.rawToken)).toBeNull();
    expect((await getCurrentSessionByToken(changed.rawToken))?.forcePasswordChange).toBe(false);
  });

  it("requires the old password for an active voluntary password change", async () => {
    const fixture = await normalAccount();
    const activeContext = context("voluntary-change");
    const issued = await login({ phone: fixture.phone, password: fixture.password }, activeContext);
    const current = (await getCurrentSessionByToken(issued.rawToken))!;
    await expect(changePassword({ current, oldPassword: "wrong", newPassword: "next-normal-password", context: activeContext })).rejects.toMatchObject({ code: "OLD_PASSWORD_INVALID" });
    const changed = await changePassword({ current, oldPassword: fixture.password, newPassword: "next-normal-password", context: activeContext });
    expect(await getCurrentSessionByToken(issued.rawToken)).toBeNull();
    expect(await getCurrentSessionByToken(changed.rawToken)).not.toBeNull();
  });

  it("aborts reset when the phone changes between the snapshot and Account lock", async () => {
    const fixture = await normalAccount();
    const active = await login({ phone: fixture.phone, password: fixture.password }, context("reset-race"));
    const original = await prisma.account.findUniqueOrThrow({ where: { id: fixture.account.id } });
    const nextPhone = phone();
    let releasePhoneUpdate!: () => void;
    let markLocked!: () => void;
    const phoneUpdateAllowed = new Promise<void>((resolve) => { releasePhoneUpdate = resolve; });
    const accountLocked = new Promise<void>((resolve) => { markLocked = resolve; });

    const phoneUpdate = prisma.$transaction(async (tx) => {
      await lockAccount(tx, fixture.account.id);
      markLocked();
      await phoneUpdateAllowed;
      await tx.account.update({ where: { id: fixture.account.id }, data: { phone: nextPhone } });
    });
    await accountLocked;

    const resetAttempt = resetPasswordToInitial(fixture.account.id);
    await new Promise((resolve) => setTimeout(resolve, 750));
    const resetRejected = expect(resetAttempt).rejects.toMatchObject({ code: "ACCOUNT_PHONE_CHANGED", status: 409 });
    releasePhoneUpdate();
    await phoneUpdate;
    await resetRejected;

    const current = await prisma.account.findUniqueOrThrow({ where: { id: fixture.account.id } });
    expect(current.phone).toBe(nextPhone);
    expect(current.passwordHash).toBe(original.passwordHash);
    expect(current.forcePasswordChange).toBe(false);
    expect(await getCurrentSessionByToken(active.rawToken)).not.toBeNull();
  });
});

describe("M0-003 device and session integration", () => {
  it("keeps at most two devices, evicts the oldest, and replaces same-device login", async () => {
    const fixture = await normalAccount();
    const first = await login({ phone: fixture.phone, password: fixture.password }, context("device-a"));
    const second = await login({ phone: fixture.phone, password: fixture.password }, context("device-b"));
    const third = await login({ phone: fixture.phone, password: fixture.password }, context("device-c"));
    expect(await getCurrentSessionByToken(first.rawToken)).toBeNull();
    expect(await getCurrentSessionByToken(second.rawToken)).not.toBeNull();
    expect(await getCurrentSessionByToken(third.rawToken)).not.toBeNull();

    const replacement = await login({ phone: fixture.phone, password: fixture.password }, context("device-c"));
    expect(await getCurrentSessionByToken(third.rawToken)).toBeNull();
    expect(await prisma.session.count({ where: { accountId: fixture.account.id, revokedAt: null, expiresAt: { gt: new Date() } } })).toBe(2);
    expect(await getCurrentSessionByToken(replacement.rawToken)).not.toBeNull();
  });

  it("returns 429 after repeated failed attempts and suppresses repeated rate-limit audit amplification", async () => {
    const fixture = await normalAccount();
    const rateContext = context("rate-limit-device");
    const rateAuditBefore = await prisma.auditLog.count({ where: { actionCode: "AUTH_LOGIN_RATE_LIMITED" } });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(login({ phone: fixture.phone, password: "wrong-password" }, { ...rateContext, requestId: randomUUID() })).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    }
    await expect(login({ phone: fixture.phone, password: "wrong-password" }, { ...rateContext, requestId: randomUUID() })).rejects.toMatchObject({ code: "AUTH_RATE_LIMITED", status: 429 });
    await expect(login({ phone: fixture.phone, password: "wrong-password" }, { ...rateContext, requestId: randomUUID() })).rejects.toMatchObject({ code: "AUTH_RATE_LIMITED", status: 429 });
    expect(await prisma.auditLog.count({ where: { actionCode: "AUTH_LOGIN_RATE_LIMITED" } })).toBe(rateAuditBefore + 1);
  });

  it("allows 45 successful accounts behind one shared NAT without increasing IP failures", async () => {
    const sharedIp = `10.240.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
    const password = "shared-nat-password";
    const passwordHash = await hashPassword(password);
    const fixtures: Array<{ phone: string; deviceId: string }> = [];
    for (let index = 0; index < 45; index += 1) {
      const owner = await person(`shared-nat-${index}`);
      const accountPhone = phone();
      await prisma.account.create({
        data: {
          personId: owner.id,
          phone: accountPhone,
          passwordHash,
          status: "NORMAL",
          firstPasswordChangedAt: new Date(),
          confidentialityConfirmedAt: new Date(),
        },
      });
      fixtures.push({ phone: accountPhone, deviceId: `shared-nat-device-${index}` });
    }

    for (const fixture of fixtures) {
      await expect(login(
        { phone: fixture.phone, password },
        { ...context(fixture.deviceId), ip: sharedIp },
      )).resolves.toMatchObject({ nextStep: "HOME" });
    }
  }, 15_000);

  it("blocks many different invalid credentials from one IP", async () => {
    const sharedIp = `10.241.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await expect(login(
        { phone: phone(), password: "wrong-password" },
        { ...context(`ip-failure-${attempt}`), ip: sharedIp },
      )).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    }
    await expect(login(
      { phone: phone(), password: "wrong-password" },
      { ...context("ip-failure-blocked"), ip: sharedIp },
    )).rejects.toMatchObject({ code: "AUTH_RATE_LIMITED", status: 429 });
  });

  it("serializes genuinely concurrent device logins on the Account row", async () => {
    const fixture = await normalAccount();
    await Promise.all(["race-a", "race-b", "race-c", "race-d"].map((deviceId) =>
      login({ phone: fixture.phone, password: fixture.password }, context(deviceId)),
    ));
    const active = await prisma.session.findMany({
      where: { accountId: fixture.account.id, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { deviceId: true },
    });
    expect(new Set(active.map(({ deviceId }) => deviceId)).size).toBeLessThanOrEqual(2);
    expect(active.length).toBeLessThanOrEqual(2);
  });

  it("invalidates a session immediately when permissionVersion changes", async () => {
    const fixture = await normalAccount();
    const issued = await login({ phone: fixture.phone, password: fixture.password }, context());
    await prisma.account.update({ where: { id: fixture.account.id }, data: { permissionVersion: { increment: 1 } } });
    expect(await getCurrentSessionByToken(issued.rawToken)).toBeNull();
  });

  it("lists only safe own-device fields and supports revoke, current logout, and logout-all", async () => {
    const fixture = await normalAccount();
    const firstContext = context("manage-a");
    const first = await login({ phone: fixture.phone, password: fixture.password }, firstContext);
    const second = await login({ phone: fixture.phone, password: fixture.password }, context("manage-b"));
    const current = (await getCurrentSessionByToken(first.rawToken))!;
    const sessions = await listOwnSessions(current);
    expect(sessions).toHaveLength(2);
    expect(JSON.stringify(sessions)).not.toContain("tokenHash");
    const other = sessions.find(({ isCurrent }) => !isCurrent)!;
    await revokeOwnSession(current, other.sessionId);
    expect(await getCurrentSessionByToken(second.rawToken)).toBeNull();

    await logoutCurrent(current, firstContext);
    expect(await getCurrentSessionByToken(first.rawToken)).toBeNull();

    const againA = await login({ phone: fixture.phone, password: fixture.password }, context("manage-a"));
    const againB = await login({ phone: fixture.phone, password: fixture.password }, context("manage-b"));
    await logoutAll((await getCurrentSessionByToken(againA.rawToken))!, context("manage-a"));
    expect(await getCurrentSessionByToken(againA.rawToken)).toBeNull();
    expect(await getCurrentSessionByToken(againB.rawToken)).toBeNull();
  });
});
