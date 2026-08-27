import Link from "next/link";
import { enterprisePageContext } from "@/lib/enterprise/page-context";
import { enterpriseListQuerySchema } from "@/modules/enterprise/schemas";

export default async function EnterpriseListPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams; const { actor, service } = await enterprisePageContext();
  const query = enterpriseListQuerySchema.parse({ keyword: typeof params.keyword === "string" ? params.keyword : undefined, areaId: typeof params.areaId === "string" ? params.areaId : undefined, tagId: typeof params.tagId === "string" ? params.tagId : undefined, page: typeof params.page === "string" ? params.page : undefined, pageSize: 20 });
  const [result, options] = await Promise.all([service.list({ actor, query }), service.formOptions({ actor, purpose: "READ_FILTER" })]);
  return <section>
    <div className="flex items-start justify-between gap-3"><div><p className="text-sm text-blue-600">企业资源</p><h2 className="mt-1 text-2xl font-semibold">企业名录</h2></div>{actor.capabilities.has("enterprise.create_application") && <Link href="/resources/enterprises/apply" className="rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white">新增申请</Link>}</div>
    <form className="mt-5 grid gap-3 rounded-2xl bg-white p-4 shadow-sm"><input name="keyword" defaultValue={query.keyword} placeholder="搜索企业名称或主要产品" className="rounded-xl border border-slate-200 p-3"/><div className="grid grid-cols-[1fr_auto] gap-2"><select name="areaId" defaultValue={query.areaId} className="rounded-xl border border-slate-200 p-3"><option value="">全部区域</option>{options.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select><button className="rounded-xl bg-slate-900 px-4 text-white">查询</button></div></form>
    <p className="mt-4 text-sm text-slate-500">共 {result.total} 家正常企业</p>
    <div className="mt-3 space-y-3">{result.items.length === 0 ? <div className="rounded-2xl bg-white p-8 text-center text-slate-500">暂无符合条件的企业，请调整筛选条件。</div> : result.items.map((item) => <Link href={`/resources/enterprises/${item.id}`} key={item.id} className="block rounded-2xl border border-slate-100 bg-white p-4 shadow-sm hover:border-blue-200"><div className="flex justify-between gap-3"><h3 className="font-semibold text-slate-950">{item.name}</h3><span className="shrink-0 text-xs text-slate-500">{item.responsibleArea.name}</span></div><p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{item.mainProducts}</p><div className="mt-3 flex flex-wrap gap-2">{item.tags.map((tag) => <span key={tag.id} className="rounded-full bg-blue-50 px-2 py-1 text-xs text-blue-700">{tag.name}</span>)}</div></Link>)}</div>
  </section>;
}
