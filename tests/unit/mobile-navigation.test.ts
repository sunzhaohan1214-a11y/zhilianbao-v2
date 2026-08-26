import { describe, expect, it } from "vitest";
import { mobileNavigation } from "../../src/components/mobile/mobile-tab-bar";

describe("mobile navigation", () => {
  it("contains exactly the four approved primary entries", () => {
    expect(mobileNavigation).toEqual([
      { href: "/", label: "首页" },
      { href: "/demands", label: "需求" },
      { href: "/resources", label: "资源" },
      { href: "/me", label: "我的" },
    ]);
  });
});
