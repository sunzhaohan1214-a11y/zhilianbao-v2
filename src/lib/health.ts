import { getPrismaClient } from "@/lib/db/prisma";

export const applicationStatus = {
  service: "zhilianbao-v2",
  status: "ok",
} as const;

const DATABASE_READINESS_TIMEOUT_MS = 2_000;
const databaseReadinessEnvironments = new Set(["test", "prod", "production"]);

type ReadinessOptions = {
  environment?: Record<string, string | undefined>;
  probe?: () => Promise<unknown>;
  timeoutMs?: number;
};

async function probeDatabase(): Promise<void> {
  await getPrismaClient().$queryRaw`SELECT 1`;
}

function databaseReadinessRequired(environment: Record<string, string | undefined>): boolean {
  return databaseReadinessEnvironments.has(environment.APP_ENV?.trim().toLowerCase() ?? "");
}

export async function getReadiness(options: ReadinessOptions = {}) {
  const environment = options.environment ?? process.env;

  if (!databaseReadinessRequired(environment)) {
    return {
      service: applicationStatus.service,
      status: "ready" as const,
      checks: {
        application: "ok" as const,
        configuration: "not-required" as const,
        database: "not-required" as const,
      },
      database: "not-required" as const,
    };
  }

  if (!environment.DATABASE_URL?.trim()) {
    return {
      service: applicationStatus.service,
      status: "not-ready" as const,
      checks: {
        application: "ok" as const,
        configuration: "error" as const,
        database: "not-checked" as const,
      },
      database: "not-configured" as const,
      errorCode: "READINESS_CONFIGURATION_MISSING" as const,
    };
  }

  const timeoutMarker = Symbol("database-readiness-timeout");
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      (options.probe ?? probeDatabase)(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(timeoutMarker), options.timeoutMs ?? DATABASE_READINESS_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    const timedOut = error === timeoutMarker;
    return {
      service: applicationStatus.service,
      status: "not-ready" as const,
      checks: {
        application: "ok" as const,
        configuration: "ok" as const,
        database: timedOut ? "timeout" as const : "error" as const,
      },
      database: timedOut ? "timeout" as const : "unavailable" as const,
      errorCode: timedOut ? "READINESS_DATABASE_TIMEOUT" as const : "READINESS_DATABASE_UNAVAILABLE" as const,
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  return {
    service: applicationStatus.service,
    status: "ready" as const,
    checks: {
      application: "ok" as const,
      configuration: "ok" as const,
      database: "ok" as const,
    },
    database: "reachable" as const,
  };
}
