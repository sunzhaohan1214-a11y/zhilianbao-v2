import Link from "next/link";
import { FormalDemandList } from "@/components/demand/formal-demand-list";
import { Button, Input, PageHeader, Select, buttonStyles, cn } from "@/components/ui";
import { formalDemandPageContext } from "@/lib/demand/formal-page-context";
import { demandListQuerySchema } from "@/modules/demand/schemas";

const statusOptions = [
  ["DRAFT", "草稿"],
  ["PENDING_REVIEW", "待审核"],
  ["RETURNED", "退回修改"],
  ["PENDING_CLAIM", "待对接"],
  ["IN_PROGRESS", "对接中"],
  ["PENDING_CLOSE_REVIEW", "待办结审核"],
  ["COMPLETED", "已办结"],
  ["CANCELED", "已取消"],
  ["MERGED", "已合并"],
] as const;

export default async function DemandsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const { actor, service } = await formalDemandPageContext();
  const query = demandListQuerySchema.parse({
    status: typeof params.status === "string" ? params.status : undefined,
    type: typeof params.type === "string" ? params.type : undefined,
    keyword: typeof params.keyword === "string" ? params.keyword : undefined,
    mine: typeof params.mine === "string" ? params.mine : undefined,
    page: typeof params.page === "string" ? params.page : undefined,
    pageSize: 20,
  });
  const result = await service.list({ actor, query });
  const canCreate = actor.capabilities.has("demand.formal.create");
  const canViewLeads = actor.capabilities.has("demand.lead.view");

  return (
    <section>
      <PageHeader
        actions={canCreate ? <Link className={buttonStyles({ size: "sm" })} href="/demands/new">新建草稿</Link> : undefined}
        description="集中查看、对接和跟进企业正式需求。"
        eyebrow="需求中心"
        title="正式需求"
      />

      {canViewLeads && (
        <Link href="/demand-leads" className="mt-5 block rounded-2xl border border-brand/15 bg-brand-soft p-4 text-sm text-brand">
          <span className="font-semibold">进入需求线索工作池</span>
          <span className="mt-1 block text-xs leading-5">线索与正式需求分开管理，不混用状态。</span>
        </Link>
      )}

      <nav aria-label="需求归属筛选" className="mt-5 grid grid-cols-2 rounded-xl bg-grouped p-1">
        <Link href="/demands" aria-current={!query.mine ? "page" : undefined} className={cn("min-h-11 content-center rounded-lg px-4 text-center text-sm font-medium", query.mine ? "text-muted" : "bg-surface text-foreground shadow-sm")}>全部需求</Link>
        <Link href="/demands?mine=true" aria-current={query.mine ? "page" : undefined} className={cn("min-h-11 content-center rounded-lg px-4 text-center text-sm font-medium", query.mine ? "bg-surface text-foreground shadow-sm" : "text-muted")}>我的需求</Link>
      </nav>

      <form aria-label="需求筛选" className="mt-4 grid gap-3 rounded-2xl border border-separator bg-surface p-4 shadow-sm">
        {query.mine && <input type="hidden" name="mine" value="true" />}
        <Input aria-label="搜索需求" name="keyword" defaultValue={query.keyword} placeholder="编号、企业或标题" />
        <div className="grid grid-cols-2 gap-3">
          <Select aria-label="需求状态" name="status" defaultValue={query.status ?? ""}>
            <option value="">全部状态</option>
            {statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
          <Select aria-label="需求类型" name="type" defaultValue={query.type ?? ""}>
            <option value="">全部类型</option>
            <option value="TECHNICAL">技术攻关</option>
            <option value="TALENT">人才合作</option>
            <option value="PROJECT">项目落地</option>
            <option value="OTHER">其他需求</option>
          </Select>
        </div>
        <Button variant="secondary">查询</Button>
      </form>

      <FormalDemandList result={result} />
      <p className="mt-3 text-sm text-muted">第 {result.page} 页，共 {result.total} 条</p>
    </section>
  );
}
