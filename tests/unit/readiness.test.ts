import { describe, expect, it } from "vitest";
import { getReadiness } from "../../src/lib/health";

describe("readiness payload", () => {
  it("reports application readiness without claiming a database connection", () => {
    expect(getReadiness()).toMatchObject({
      status: "ready",
      checks: { application: "ok", configuration: "ok" },
      database: "not-configured",
    });
  });
});
