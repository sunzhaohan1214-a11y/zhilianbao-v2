import { describe, expect, it } from "vitest";
import { futureShanghaiPresenceInterval } from "../e2e/presence-time";

describe("Presence E2E Shanghai intervals", () => {
  it("stays in the future across a Shanghai month boundary", () => {
    expect(futureShanghaiPresenceInterval(new Date("2026-08-31T15:30:00Z"), 1)).toEqual({
      arrivalAtLocal: "2026-09-01T09:00",
      expectedDepartureAtLocal: "2026-09-01T18:00",
      arrivalAtIso: "2026-09-01T09:00:00+08:00",
      expectedDepartureAtIso: "2026-09-01T18:00:00+08:00",
    });
  });

  it("uses Asia/Shanghai rather than the process or browser timezone", () => {
    expect(futureShanghaiPresenceInterval(new Date("2026-12-31T16:30:00Z"), 1).arrivalAtLocal)
      .toBe("2027-01-02T09:00");
  });

  it("rejects a non-future fixture interval", () => {
    expect(() => futureShanghaiPresenceInterval(new Date("2026-08-29T00:00:00Z"), 0))
      .toThrow("at least one Shanghai business day ahead");
  });
});
