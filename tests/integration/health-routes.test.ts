import { afterEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({ queryRaw: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({
  getPrismaClient: () => ({ $queryRaw: database.queryRaw }),
}));

import { getReadiness } from "../../src/lib/health";
import { GET as getHealth } from "../../src/app/health/route";
import { GET as getReady } from "../../src/app/ready/route";

describe("health route handlers", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("returns a healthy process response", async () => {
    const response = getHealth();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "ok" });
  });

  it.each(["test", "prod"])("requires a successful read-only database probe in %s", async (appEnvironment) => {
    const probe = vi.fn().mockResolvedValue([{ "1": 1 }]);
    const result = await getReadiness({
      environment: { APP_ENV: appEnvironment, DATABASE_URL: "configured" },
      probe,
    });

    expect(probe).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      status: "ready",
      checks: { application: "ok", configuration: "ok", database: "ok" },
      database: "reachable",
    });
  });

  it("returns HTTP 200 only after the configured database probe succeeds", async () => {
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("DATABASE_URL", "configured");
    database.queryRaw.mockResolvedValue([{ "1": 1 }]);

    const response = await getReady();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ status: "ready", database: "reachable" });
  });

  it.each(["test", "prod"])("fails closed when the database is unreachable in %s", async (appEnvironment) => {
    const result = await getReadiness({
      environment: { APP_ENV: appEnvironment, DATABASE_URL: "configured" },
      probe: vi.fn().mockRejectedValue(new Error("connection refused")),
    });

    expect(result).toMatchObject({
      status: "not-ready",
      checks: { application: "ok", configuration: "ok", database: "error" },
      database: "unavailable",
      errorCode: "READINESS_DATABASE_UNAVAILABLE",
    });
  });

  it("returns HTTP 503 with a stable body when the configured database is unavailable", async () => {
    vi.stubEnv("APP_ENV", "prod");
    vi.stubEnv("DATABASE_URL", "mysql://user:password@private-host:3306/app");
    database.queryRaw.mockRejectedValue(new Error("raw driver failure"));

    const response = await getReady();

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      service: "zhilianbao-v2",
      status: "not-ready",
      checks: { application: "ok", configuration: "ok", database: "error" },
      database: "unavailable",
      errorCode: "READINESS_DATABASE_UNAVAILABLE",
    });
  });

  it.each(["test", "prod"])("fails closed without DATABASE_URL in %s", async (appEnvironment) => {
    const probe = vi.fn();
    const result = await getReadiness({ environment: { APP_ENV: appEnvironment }, probe });

    expect(probe).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "not-ready",
      checks: { application: "ok", configuration: "error", database: "not-checked" },
      database: "not-configured",
      errorCode: "READINESS_CONFIGURATION_MISSING",
    });
  });

  it("fails closed when the database probe times out", async () => {
    const result = await getReadiness({
      environment: { APP_ENV: "test", DATABASE_URL: "configured" },
      probe: () => new Promise(() => undefined),
      timeoutMs: 1,
    });

    expect(result).toMatchObject({
      status: "not-ready",
      checks: { application: "ok", configuration: "ok", database: "timeout" },
      database: "timeout",
      errorCode: "READINESS_DATABASE_TIMEOUT",
    });
  });

  it("keeps liveness healthy while database readiness is down", async () => {
    const readiness = await getReadiness({
      environment: { APP_ENV: "test", DATABASE_URL: "configured" },
      probe: vi.fn().mockRejectedValue(new Error("database down")),
    });
    const health = getHealth();

    expect(readiness.status).toBe("not-ready");
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toMatchObject({ status: "ok" });
  });

  it("does not expose database credentials, SQL, or raw failures", async () => {
    const sensitiveUrl = "mysql://readiness-user:super-secret@private-db:3306/app";
    const result = await getReadiness({
      environment: { APP_ENV: "prod", DATABASE_URL: sensitiveUrl },
      probe: vi.fn().mockRejectedValue(new Error(`SELECT 1 failed for ${sensitiveUrl}`)),
    });
    const serialized = JSON.stringify(result);

    for (const forbidden of [sensitiveUrl, "readiness-user", "super-secret", "private-db", "SELECT 1", "failed for"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
