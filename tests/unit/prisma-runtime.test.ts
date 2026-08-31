import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ clients: [] as object[], disconnect: vi.fn(async () => undefined) }));
vi.mock("@prisma/adapter-mariadb", () => ({ PrismaMariaDb: class PrismaMariaDb {} }));
vi.mock("@/generated/prisma/client", () => ({
  PrismaClient: class PrismaClient {
    $disconnect = mocks.disconnect;
    constructor() { mocks.clients.push(this); }
  },
}));

import { disconnectPrismaClient, getPrismaClient } from "@/lib/db/prisma";

describe("Prisma per-process lifecycle", () => {
  beforeEach(() => { process.env.DATABASE_URL = "mysql://unit:unit@127.0.0.1:3306/unit"; });
  afterEach(async () => { await disconnectPrismaClient(); mocks.clients.length = 0; mocks.disconnect.mockClear(); });

  it.each(["production", "development", "test"])("reuses one client in %s", (environment) => {
    vi.stubEnv("NODE_ENV", environment);
    expect(getPrismaClient()).toBe(getPrismaClient());
  });

  it("returns exactly one unique client across 1000 calls", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(new Set(Array.from({ length: 1_000 }, () => getPrismaClient())).size).toBe(1);
    expect(mocks.clients).toHaveLength(1);
  });

  it("clears before disconnect, creates a fresh client, and permits repeated disconnect", async () => {
    const first = getPrismaClient();
    await disconnectPrismaClient();
    await expect(disconnectPrismaClient()).resolves.toBeUndefined();
    expect(getPrismaClient()).not.toBe(first);
    expect(mocks.disconnect).toHaveBeenCalledTimes(1);
  });
});
