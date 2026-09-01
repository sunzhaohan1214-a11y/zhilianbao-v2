import Link from "next/link";
import { Badge, PageHeader, buttonStyles } from "@/components/ui";
import { visibleAdminWorkbenchEntries } from "@/components/admin/admin-workbench-model";
import { requireAdminShellPermission, requireBusinessPageSession } from "@/lib/auth/guards";

const modules = [
  { capability: "member.manage", title: "人员与团员", href: "/admin/members" },
  { capability: "organization.manage", title: "组织与任职", href: "/admin/organizations" },
  { capability: "presence.history.admin_view", title: "来离宝记录", href: "/admin/presence" },
  { capability: "report.view", title: "月度工作台账", href: "/reports/monthly" },
  { capability: "system.health.view", title: "系统治理", href: "/admin/system" },
] as const;

export default async function AdminPage() {
  const session = await requireBusinessPageSession();
  const { actor } = await requireAdminShellPermission(session);
  const visibleQueues = visibleAdminWorkbenchEntries(actor.capabilities);
  const visibleModules = modules.filter((item) => actor.capabilities.has(item.capability));

  return (
    <section>
      <PageHeader description="科技镇长团内部业务处理入口；不虚报数量，进入对应模块后查看当前记录与状态。" eyebrow="产业协同管理" title="业务处理入口" />
      {visibleQueues.length > 0 ? (
        <div className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleQueues.map((item) => (
            <article className="flex min-h-48 flex-col rounded-2xl border border-separator bg-surface p-5 shadow-sm" key={item.capability}>
              <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">{item.title}</h2><Badge tone="neutral">按权限显示</Badge></div>
              <p className="mt-3 flex-1 text-sm leading-6 text-muted">{item.description}</p>
              <Link className={buttonStyles({ variant: "secondary", size: "sm", className: "mt-5 self-start" })} href={item.href}>进入处理</Link>
            </article>
          ))}
        </div>
      ) : (
        <div className="mt-7 rounded-2xl border border-separator bg-surface p-8 text-center text-sm text-muted">当前账号没有额外业务处理入口，可使用导航访问已授权模块。</div>
      )}

      {visibleModules.length > 0 && (
        <section className="mt-10" aria-labelledby="management-modules-title">
          <div className="flex items-end justify-between gap-4"><div><h2 className="text-xl font-semibold" id="management-modules-title">常用管理</h2><p className="mt-1 text-sm text-muted">按权限显示可访问模块。</p></div></div>
          <div className="mt-4 flex flex-wrap gap-3">{visibleModules.map((item) => <Link className="min-h-11 content-center rounded-xl border border-separator bg-surface px-4 text-sm font-medium shadow-sm hover:border-brand/30 hover:text-brand" href={item.href} key={item.href}>{item.title}</Link>)}</div>
        </section>
      )}
    </section>
  );
}
