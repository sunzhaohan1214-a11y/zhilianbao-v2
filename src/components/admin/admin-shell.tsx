"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = readonly [label: string, href: string, capability: string];

export const adminNavigation: ReadonlyArray<{ label: string; items: readonly NavItem[] }> = [
  { label: "工作台", items: [["工作台", "/admin", "admin.shell.access"]] },
  { label: "需求与成效", items: [["正式需求", "/admin/demands", "demand.review"], ["需求线索", "/admin/demand-leads", "demand.lead.view"]] },
  { label: "资源管理", items: [["企业管理", "/admin/enterprises", "enterprise.edit_formal"], ["企业申请审核", "/admin/enterprise-change-requests", "enterprise.edit_formal"], ["人才管理", "/admin/talents", "talent.review"], ["人才申请审核", "/admin/talent-change-requests", "talent.review"], ["政策治理", "/admin/policies", "policy.create"], ["地图治理", "/admin/maps", "enterprise.map.manage"]] },
  { label: "工作动态", items: [["来离宝管理", "/admin/presence", "presence.history.admin_view"], ["行程与走访", "/admin/trips", "trip.correct.admin"]] },
  { label: "事务管理", items: [["办事求助", "/admin/help-requests", "help.assign"], ["公告治理", "/admin/announcements", "announcement.create"]] },
  { label: "数据与报表", items: [["数据导入", "/admin/imports", "import.execute"], ["月度工作台账", "/reports/monthly", "report.view"]] },
  { label: "用户与组织", items: [["人员与团员", "/admin/members", "member.manage"], ["批次与团长", "/admin/batches", "member.batch.manage"], ["组织与任职", "/admin/organizations", "organization.manage"]] },
  { label: "智能服务", items: [["荷宝助手", "/ai", "ai.assistant.use"]] },
  { label: "系统管理", items: [["系统治理", "/admin/system", "system.health.view"]] },
];

function isCurrent(pathname: string, href: string) {
  if (href === "/admin") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminShell({ children, capabilities }: Readonly<{ children: ReactNode; capabilities: readonly string[] }>) {
  const pathname = usePathname();
  const allowed = new Set(capabilities);
  const groups = adminNavigation.map((group) => ({ ...group, items: group.items.filter(([, , capability]) => allowed.has(capability)) })).filter((group) => group.items.length > 0);

  return (
    <div className="min-h-dvh bg-background lg:grid lg:grid-cols-[256px_minmax(0,1fr)]">
      <aside className="border-b border-separator bg-surface lg:sticky lg:top-0 lg:h-dvh lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="border-b border-separator px-5 py-5">
          <Link className="flex items-center gap-3" href="/admin">
            <span className="grid size-10 place-items-center rounded-xl bg-brand text-sm font-semibold text-white shadow-sm">智</span>
            <span><strong className="block text-[17px] tracking-tight">智链宝</strong><span className="block text-xs text-muted">管理工作台</span></span>
          </Link>
        </div>
        <nav aria-label="管理后台导航" className="flex gap-2 overflow-x-auto px-4 py-3 lg:block lg:space-y-5 lg:overflow-visible lg:py-5">
          {groups.map((group) => (
            <section className="shrink-0" key={group.label} aria-label={group.label}>
              <h2 className="hidden px-3 text-[11px] font-semibold tracking-[0.08em] text-tertiary lg:block">{group.label}</h2>
              <div className="flex gap-1 lg:mt-1 lg:block lg:space-y-0.5">
                {group.items.map(([label, href]) => {
                  const current = isCurrent(pathname, href);
                  return <Link aria-current={current ? "page" : undefined} key={href} className={`block min-h-10 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${current ? "bg-brand-soft text-brand" : "text-muted hover:bg-surface-secondary hover:text-foreground"}`} href={href}>{label}</Link>;
                })}
              </div>
            </section>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 p-5 sm:p-7 lg:p-10 xl:p-12"><div className="mx-auto max-w-[1440px]">{children}</div></main>
    </div>
  );
}
