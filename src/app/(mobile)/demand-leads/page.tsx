import Link from "next/link";
import { demandLeadPageContext } from "@/lib/demand/page-context";

const leadStatusLabel: Record<string, string> = {
  UNVERIFIED: "待核验",
  PENDING_VERIFY: "待核验",
  VERIFIED: "已核验",
  LINKED: "已关联",
  CONVERTED: "已转正式需求",
  CLOSED: "已关闭",
  MERGED: "已合并",
};

export default async function DemandLeadWorkPoolPage() {
  const { actor, service } = await demandLeadPageContext();
  if (!actor.capabilities.has("demand.lead.view")) {
    return <section><p className="text-sm font-medium text-blue-600">需求线索</p><h2 className="mt-1 text-2xl font-semibold">不能查看发布前需求线索</h2><div className="mt-6 rounded-3xl border border-dashed border-black/10 bg-white p-8 text-center"><p className="font-medium">当前账号无需求线索权限</p><p className="mt-2 text-sm text-neutral-500">普通团员只能查看已发布正式需求。</p></div></section>;
  }
  const result = await service.list({ actor, query: { page: 1, pageSize: 20, actionableOnly: false } });
  return <section><p className="text-sm font-medium text-brand">需求 · 线索工作池</p><h2 className="mt-1 text-2xl font-semibold">待核验线索</h2><p className="mt-2 text-sm text-muted">仅展示当前账号有权处理的负责区域；线索状态不与正式需求混用。</p><div className="mt-5 space-y-3">{result.items.map((lead) => <Link key={lead.id} href={`/demand-leads/${lead.id}`} className="block rounded-2xl border border-separator bg-surface p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-medium text-brand">{lead.businessNo}</p><h3 className="mt-1 font-semibold">{lead.rawTitle}</h3><p className="mt-1 text-sm text-muted">{lead.rawEnterpriseName ?? lead.enterprise?.name ?? "待关联企业"}</p></div><span className="rounded-full bg-brand-soft px-2 py-1 text-xs text-brand">{leadStatusLabel[lead.status] ?? "状态待确认"}</span></div></Link>)}{result.items.length === 0 && <div className="rounded-2xl border border-dashed border-separator bg-surface p-8 text-center text-sm text-muted">当前工作池暂无线索。</div>}</div></section>;
}
