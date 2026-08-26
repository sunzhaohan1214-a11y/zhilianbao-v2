import Link from "next/link";

export const mobileNavigation = [
  { href: "/", label: "首页" },
  { href: "/demands", label: "需求" },
  { href: "/resources", label: "资源" },
  { href: "/me", label: "我的" },
] as const;

export function MobileTabBar() {
  return (
    <nav
      aria-label="手机主导航"
      className="fixed inset-x-0 bottom-0 z-20 mx-auto grid max-w-[480px] grid-cols-4 border-t border-black/10 bg-white/90 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl"
    >
      {mobileNavigation.map((item) => (
        <Link
          className="rounded-xl px-2 py-2 text-center text-sm font-medium text-neutral-600 transition hover:bg-blue-50 hover:text-blue-600"
          href={item.href}
          key={item.href}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
