import { describe, expect, it } from "vitest";
import { getReadiness } from "../../src/lib/health";

describe("readiness payload", () => {
  it("does not require a deployment database probe in the local environment", async () => {
    await expect(getReadiness({ environment: { APP_ENV: "local" } })).resolves.toMatchObject({
      status: "ready",
      checks: { application: "ok", configuration: "not-required", database: "not-required" },
      database: "not-required",
    });
  });
});
