import { afterEach, describe, expect, it, vi } from "vitest";
import { getReadiness } from "../../src/lib/health";

describe("readiness payload", () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  it("does not require a deployment database probe in the local environment", async () => {
    await expect(getReadiness({ environment: { APP_ENV: "local" } })).resolves.toMatchObject({
      status: "ready",
      checks: { application: "ok", configuration: "not-required", database: "not-required" },
      database: "not-required",
    });
  });

  it("classifies a database timeout without exposing its error", async () => {
    vi.useFakeTimers();
    const output = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const readiness = getReadiness({ environment: { APP_ENV: "test", DATABASE_URL: "configured" }, probe: () => new Promise(() => undefined), timeoutMs: 25 });
    await vi.advanceTimersByTimeAsync(25);
    await expect(readiness).resolves.toMatchObject({ status: "not-ready", errorCode: "READINESS_DATABASE_TIMEOUT" });
    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({ result: "not_ready", stage: "database_probe", errorCode: "READINESS_DATABASE_TIMEOUT" });
  });

  it("warns only for a slow successful database probe", async () => {
    vi.useFakeTimers();
    const output = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const readiness = getReadiness({ environment: { APP_ENV: "test", DATABASE_URL: "configured" }, probe: () => new Promise((resolve) => setTimeout(resolve, 1_100)), timeoutMs: 2_000 });
    await vi.advanceTimersByTimeAsync(1_100);
    await expect(readiness).resolves.toMatchObject({ status: "ready" });
    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({ result: "slow", stage: "database_probe" });
  });
});
