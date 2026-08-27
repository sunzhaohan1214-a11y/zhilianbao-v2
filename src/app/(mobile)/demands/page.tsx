import Link from "next/link";
import { FormalDemandList } from "@/components/demand/formal-demand-list";
import { formalDemandPageContext } from "@/lib/demand/formal-page-context";
import { demandListQuerySchema } from "@/modules/demand/schemas";

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
  return <section><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium text-blue-600">需求中心</p><h2 className="mt-1 text-2xl font-semibold">正式需求</h2></div>{canCreate && <Link href="/demands/new" className="rounded-xl bg-blue-600 px-4 py-2 text-sm text-white">新建草稿</Link>}</div>{canViewLeads && <Link href="/demand-leads" className="mt-4 block rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800"><span className="font-medium">进入需求线索工作池</span><span className="mt-1 block text-xs text-blue-600">线索与正式需求分开管理，不混用状态。</span></Link>}<nav className="mt-5 flex gap-2"><Link href="/demands" className={`rounded-full px-4 py-2 text-sm ${query.mine ? "bg-white text-slate-600" : "bg-slate-900 text-white"}`}>全部需求</Link><Link href="/demands?mine=true" className={`rounded-full px-4 py-2 text-sm ${query.mine ? "bg-slate-900 text-white" : "bg-white text-slate-600"}`}>我的需求</Link></nav><form className="mt-3 grid gap-3 rounded-2xl border bg-white p-4">{query.mine && <input type="hidden" name="mine" value="true"/>}<input name="keyword" defaultValue={query.keyword} placeholder="编号 / 企业 / 标题" className="rounded-xl border p-3"/><div className="grid grid-cols-2 gap-3"><select name="status" defaultValue={query.status ?? ""} className="rounded-xl border p-3"><option value="">全部状态</option>{["DRAFT","PENDING_REVIEW","RETURNED","PENDING_CLAIM","IN_PROGRESS","PENDING_CLOSE_REVIEW","COMPLETED","CANCELED","MERGED"].map((status) => <option key={status}>{status}</option>)}</select><select name="type" defaultValue={query.type ?? ""} className="rounded-xl border p-3"><option value="">全部类型</option><option value="TECHNICAL">技术攻关</option><option value="TALENT">人才合作</option><option value="PROJECT">项目落地</option><option value="OTHER">其他需求</option></select></div><button className="min-h-11 rounded-xl bg-slate-900 text-white">查询</button></form><FormalDemandList result={result}/><p className="mt-3 text-sm text-slate-500">第 {result.page} 页，共 {result.total} 条</p></section>;
}
