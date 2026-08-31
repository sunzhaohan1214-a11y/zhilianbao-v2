import Link from "next/link";
import { Badge, PageHeader, buttonStyles } from "@/components/ui";
import { requireAdminShellPermission, requireBusinessPageSession } from "@/lib/auth/guards";

const queues = [
  { capability: "demand.review", title: "需求审核", description: "处理待审核、待办结审核与主责变更。", href: "/admin/demands?status=PENDING_REVIEW" },
  { capability: "demand.lead.view", title: "线索核验", description: "核验来源信息、关联企业并转为正式草稿。", href: "/admin/demand-leads" },
  { capability: "help.assign", title: "办事求助", description: "分派、改派并跟进当前求助事项。", href: "/admin/help-requests" },
  { capability: "enterprise.edit_formal", title: "企业申请审核", description: "核对企业新增与信息变更申请。", href: "/admin/enterprise-change-requests" },
  { capability: "talent.review", title: "人才申请审核", description: "核对人才推荐、纠错与对接记录。", href: "/admin/talent-change-requests" },
  { capability: "import.execute", title: "导入待处理", description: "查看阻塞行、完成消歧并确认整批导入。", href: "/admin/imports" },
] as const;

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
  const visibleQueues = queues.filter((item) => actor.capabilities.has(item.capability));
  const visibleModules = modules.filter((item) => actor.capabilities.has(item.capability));

  return (
    <section>
      <PageHeader description="先处理当前业务队列，再进入数据与治理模块。" eyebrow="管理工作台" title="待处理事项" />
      {visibleQueues.length > 0 ? (
        <div className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleQueues.map((item) => (
            <article className="flex min-h-48 flex-col rounded-2xl border border-separator bg-surface p-5 shadow-sm" key={item.href}>
              <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">{item.title}</h2><Badge tone="warning">待处理队列</Badge></div>
              <p className="mt-3 flex-1 text-sm leading-6 text-muted">{item.description}</p>
              <Link className={buttonStyles({ variant: "secondary", size: "sm", className: "mt-5 self-start" })} href={item.href}>进入处理</Link>
            </article>
          ))}
        </div>
      ) : (
        <div className="mt-7 rounded-2xl border border-separator bg-surface p-8 text-center text-sm text-muted">当前账号没有可处理的管理队列。</div>
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
