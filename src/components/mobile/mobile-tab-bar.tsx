"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DemandIcon, HomeIcon, ProfileIcon, ResourceIcon } from "./mobile-icons";

export const mobileNavigation = [
  { href: "/", label: "首页" },
  { href: "/demands", label: "需求" },
  { href: "/resources", label: "资源" },
  { href: "/me", label: "我的" },
] as const;

const navigationIcons = { "/": HomeIcon, "/demands": DemandIcon, "/resources": ResourceIcon, "/me": ProfileIcon } as const;

const visibleResourceLists = new Set([
  "/resources/contacts",
  "/resources/enterprises",
  "/resources/members",
  "/resources/policies",
  "/resources/talents",
]);

export function mobileTabForPath(pathname: string) {
  if (pathname === "/") return "/";
  if (pathname === "/demands") return "/demands";
  if (pathname === "/resources" || visibleResourceLists.has(pathname)) return "/resources";
  if (pathname === "/me") return "/me";
  return null;
}

export function MobileTabBar() {
  const pathname = usePathname();
  const activeTab = mobileTabForPath(pathname);
  if (!activeTab) return null;
  return (
    <nav
      aria-label="手机主导航"
      className="fixed inset-x-0 bottom-0 z-20 mx-auto grid max-w-[480px] grid-cols-4 border-t border-separator bg-white/92 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5 shadow-[0_-8px_24px_rgba(16,24,40,0.04)] backdrop-blur-xl"
    >
      {mobileNavigation.map((item) => {
        const isActive = activeTab === item.href;
        const Icon = navigationIcons[item.href];
        return (
          <Link
            aria-current={isActive ? "page" : undefined}
            className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-2 text-[11px] font-medium transition-colors ${isActive ? "text-brand" : "text-tertiary hover:bg-brand-soft hover:text-brand"}`}
            href={item.href}
            key={item.href}
          >
            <Icon className="size-[22px]" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
