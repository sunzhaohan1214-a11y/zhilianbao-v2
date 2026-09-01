import { describe, expect, it } from "vitest";
import { mobileNavigation, mobileTabForPath } from "@/components/mobile/mobile-tab-bar";

describe("mobile navigation UI", () => {
  it("keeps exactly the four approved primary tabs", () => {
    expect(mobileNavigation.map(({ label }) => label)).toEqual(["首页", "需求", "资源", "我的"]);
  });

  it("keeps resource list context while hiding detail and create routes", () => {
    expect(mobileTabForPath("/resources/enterprises")).toBe("/resources");
    expect(mobileTabForPath("/resources/enterprises/enterprise-1")).toBeNull();
    expect(mobileTabForPath("/demands/new")).toBeNull();
    expect(mobileTabForPath("/presence/current")).toBeNull();
  });
});
