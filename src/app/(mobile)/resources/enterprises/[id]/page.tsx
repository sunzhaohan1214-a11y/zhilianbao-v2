import Link from "next/link";
import { EnterpriseCorrectionForm } from "@/components/enterprise/change-request-forms";
import { enterprisePageContext } from "@/lib/enterprise/page-context";

export default async function EnterpriseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const { actor, service } = await enterprisePageContext(); const item = await service.detail({ actor, enterpriseId: id });
  if (!item) return null;
  return <article><Link href="/resources/enterprises" className="text-sm text-blue-600">‹ 返回企业名录</Link>
    {item.status === "DISABLED" && <div className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">该企业已停用，信息仅供历史查阅。</div>}
    {item.status === "MERGED" && <div className="mt-4 rounded-xl bg-purple-50 p-3 text-sm text-purple-800">该企业已合并。{item.mergedInto && <Link className="ml-1 underline" href={`/resources/enterprises/${item.mergedInto.id}`}>查看承接企业：{item.mergedInto.name}</Link>}</div>}
    <header className="mt-4 rounded-2xl bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-sm text-blue-600">{item.responsibleArea.name}</p><h1 className="mt-1 text-2xl font-semibold">{item.name}</h1></div><span className="rounded-full bg-slate-100 px-2 py-1 text-xs">v{item.currentVersion}</span></div><p className="mt-4 text-sm leading-6 text-slate-600">{item.address}</p><div className="mt-3 flex flex-wrap gap-2">{item.tags.map((tag) => <span key={tag.id} className="rounded-full bg-blue-50 px-2 py-1 text-xs text-blue-700">{tag.name}</span>)}</div></header>
    <Info title="企业简介" value={item.introduction} /><Info title="主要产品/服务" value={item.mainProducts} /><Info title="资质荣誉" value={item.qualificationsHonors} />
    <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm"><h2 className="font-semibold">企业联系人</h2>{item.contacts.filter((c) => c.status === "ACTIVE").length === 0 ? <p className="mt-3 text-sm text-slate-500">暂无有效联系人。</p> : item.contacts.filter((c) => c.status === "ACTIVE").map((c) => <div key={c.id} className="mt-3 border-t border-slate-100 pt-3 text-sm"><div className="flex justify-between"><span>{c.name} {c.positionTitle ?? ""}</span>{c.isPrimary && <span className="text-blue-600">主要联系人</span>}</div><a className="mt-1 inline-block text-blue-600" href={`tel:${c.phone}`}>{c.phone}</a></div>)}</section>
    {["关联需求", "走访记录", "成果记录"].map((title) => <section key={title} className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-white p-5"><h2 className="font-semibold">{title}</h2><p className="mt-2 text-sm text-slate-500">暂无记录；对应业务将在后续里程碑接入。</p></section>)}
    {item.status !== "MERGED" && actor.capabilities.has("enterprise.correct_request") && <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm"><h2 className="font-semibold">发现信息有误？</h2><p className="my-3 text-sm text-slate-500">提交结构化纠错申请，管理员审核后才会更新正式数据。</p><EnterpriseCorrectionForm enterpriseId={item.id} baseVersion={item.currentVersion} name={item.name} address={item.address} mainProducts={item.mainProducts} /></section>}
  </article>;
}

function Info({ title, value }: { title: string; value: string | null }) { return <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm"><h2 className="font-semibold">{title}</h2><p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-600">{value || "暂无信息"}</p></section>; }
