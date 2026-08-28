import type { ReactNode } from "react";
import Link from "next/link";

const NAVIGATION = [
  ["工作台", "/admin", "admin.shell.access"], ["正式需求", "/admin/demands", "demand.review"], ["需求线索", "/admin/demand-leads", "demand.lead.view"], ["办事求助", "/admin/help-requests", "help.assign"], ["公告治理", "/admin/announcements", "announcement.create"], ["企业管理", "/admin/enterprises", "enterprise.edit_formal"], ["企业申请审核", "/admin/enterprise-change-requests", "enterprise.edit_formal"], ["人才管理", "/admin/talents", "talent.review"], ["人才申请审核", "/admin/talent-change-requests", "talent.review"], ["人员与团员", "/admin/members", "member.manage"], ["批次与团长", "/admin/batches", "member.batch.manage"], ["组织与任职", "/admin/organizations", "organization.manage"], ["地图治理", "/admin/maps", "enterprise.map.manage"], ["来离宝管理", "/admin/presence", "presence.history.admin_view"], ["行程与走访", "/admin/trips", "trip.correct.admin"], ["政策治理", "/admin/policies", "policy.create"], ["数据导入", "/admin/imports", "import.execute"], ["系统治理", "/admin/system", "system.health.view"],
] as const;
export function AdminShell({ children, capabilities }: Readonly<{ children: ReactNode; capabilities: readonly string[] }>) {
  const allowed = new Set(capabilities);
  return (
    <div className="min-h-dvh bg-slate-50 lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="border-b border-slate-200 bg-white px-6 py-6 text-slate-950 lg:border-b-0 lg:border-r">
        <p className="text-xs font-medium tracking-[0.2em] text-blue-600">ZHILIANBAO</p>
        <p className="mt-2 text-xl font-semibold">PC 管理后台</p>
        <nav className="mt-8 space-y-1 text-sm">
          {NAVIGATION.filter(([, , capability]) => allowed.has(capability)).map(([label, href]) => <Link key={href} className="block rounded-xl px-3 py-2 hover:bg-blue-50 hover:text-blue-700" href={href}>{label}</Link>)}
        </nav>
      </aside>
      <main className="p-6 lg:p-10">{children}</main>
    </div>
  );
}
