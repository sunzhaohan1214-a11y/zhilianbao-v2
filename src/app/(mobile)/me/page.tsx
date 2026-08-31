import Link from "next/link";
import { reimbursementPageContext } from "@/lib/reimbursement/page-context";
import { canViewMonthlyReport } from "@/modules/reporting/reporting-scope";

function MenuLink({ description, href, title }: { description: string; href: string; title: string }) {
  return <Link href={href} className="flex min-h-[72px] items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-surface-secondary"><span className="min-w-0"><strong className="block text-[15px] font-semibold text-foreground">{title}</strong><span className="mt-1 block text-xs leading-5 text-muted">{description}</span></span><span aria-hidden="true" className="text-xl text-tertiary">›</span></Link>;
}

function MenuGroup({ children, label }: { children: React.ReactNode; label: string }) {
  return <section className="mt-7"><h2 className="mb-2 px-1 text-xs font-semibold tracking-wide text-tertiary">{label}</h2><div className="divide-y divide-separator overflow-hidden rounded-2xl border border-separator bg-surface shadow-sm">{children}</div></section>;
}

export default async function MePage() {
  const { actor } = await reimbursementPageContext();
  return (
    <section>
      <header><p className="text-sm font-medium text-brand">个人中心</p><h1 className="mt-1 text-[28px] font-semibold tracking-tight">我的</h1></header>

      <MenuGroup label="工作">
        <MenuLink href="/presence" title="来离宝" description="填报完整来宝安排、查看当前在宝" />
        <MenuLink href="/me/work/trips" title="工作行程" description="共享多节点行程、结果与企业走访" />
        {canViewMonthlyReport(actor) && <MenuLink href="/reports/monthly" title="月度工作台账" description="查看结构化月报并生成固定五表 Excel" />}
      </MenuGroup>

      <MenuGroup label="个人事务">
        <MenuLink href="/help-requests" title="办事求助" description="发起住宿、交通、用餐、工作与生活求助" />
        <MenuLink href="/reimbursements" title="报销" description="出行或活动报销、票据识别与材料流转" />
        {(actor.hasSystem || actor.specialPermissions.has("reimbursement.manage")) && <MenuLink href="/reimbursement-admin" title="报销管理" description="线上核对、纸质材料与财务流转记录" />}
        <MenuLink href="/messages" title="消息" description="查看业务状态与公告更新" />
        <MenuLink href="/todos" title="待办" description="查看当前可以立即处理的事项" />
        <MenuLink href="/announcements" title="通知公告" description="查看公告与确认要求" />
      </MenuGroup>

      <MenuGroup label="账号与资料">
        <MenuLink href="/account/security" title="账号安全" description="查看设备、修改密码或退出登录" />
        <MenuLink href="/me/capability-profile" title="我的能力画像" description="维护专业方向、可协调资源与需求偏好" />
      </MenuGroup>
    </section>
  );
}
