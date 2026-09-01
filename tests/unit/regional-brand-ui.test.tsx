import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AuthCard } from "@/components/auth/auth-card";
import { BrandLogo } from "@/components/mobile/brand-logo";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function relativeLuminance(hex: string) {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

function contrast(foreground: string, background: string) {
  const values = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe("regional product identity", () => {
  it("keeps the local identity tied to the real internal platform purpose", () => {
    const html = renderToStaticMarkup(<AuthCard eyebrow="ZHILIANBAO" title="登录智链宝" description="登录说明">表单</AuthCard>);
    expect(html).toContain("扬州市电力装备产业科技镇长团");
    expect(html).toContain("内部产业协同工作平台");
    expect(html).toContain("数据以系统正式记录为准");
  });

  it("uses restrained water and lotus tokens without replacing the primary brand color", () => {
    const css = source("src/app/globals.css");
    expect(css).toContain("--water: #426d7a");
    expect(css).toContain("--lotus: #5f7d65");
    expect(css).toContain(".baoying-atmosphere");
    expect(contrast("#426d7a", "#e8eeea")).toBeGreaterThanOrEqual(4.5);
    const logo = renderToStaticMarkup(<BrandLogo />);
    expect(logo).toContain("bg-brand");
    expect(logo).toContain("bg-lotus");
  });

  it("applies one shared atmosphere to mobile and admin shells", () => {
    expect(source("src/components/mobile/mobile-shell.tsx")).toContain("baoying-atmosphere");
    const adminShell = source("src/components/admin/admin-shell.tsx");
    expect(adminShell).toContain("baoying-atmosphere");
    expect(adminShell).toContain("<BrandLogo />");
    expect(adminShell).not.toContain(">智</span>");
  });
});
