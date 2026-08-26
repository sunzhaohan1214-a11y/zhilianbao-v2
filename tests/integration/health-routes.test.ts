import { describe, expect, it } from "vitest";
import { GET as getHealth } from "../../src/app/health/route";
import { GET as getReady } from "../../src/app/ready/route";

describe("health route handlers", () => {
  it("returns a healthy process response", async () => {
    const response = getHealth();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "ok" });
  });

  it("returns a ready response with no database claim", async () => {
    const response = getReady();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ready",
      database: "not-configured",
    });
  });
});
