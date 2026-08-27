import Link from "next/link";
import { memberFoundationPageContext } from "@/lib/member-foundation/page-context";
export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ organizationId?: string }> }) {
  const { actor, organizations } = await memberFoundationPageContext(); const params = await searchParams;
  const items = await organizations.list({ actor }); const selected = params.organizationId ? items.find(({ id }) => id === params.organizationId) : null;
  return <section><h1 className="text-2xl font-semibold">通讯录</h1><p className="mt-2 text-sm text-slate-500">先选组织，再查看当前在岗人员；已结束任职不会显示。</p>
    <div className="mt-5 space-y-3">{!selected ? items.map((item) => <Link key={item.id} href={`/resources/contacts?organizationId=${item.id}`} className="flex items-center justify-between rounded-2xl bg-white p-4 shadow-sm"><span><strong>{item.name}</strong><small className="ml-2 text-slate-400">{item.staffCount} 人</small></span><span className="text-blue-600">›</span></Link>) : <><Link href="/resources/contacts" className="text-sm text-blue-600">‹ 返回组织</Link><div className="rounded-2xl bg-white p-5"><h2 className="font-semibold">{selected.name}</h2>{selected.phone && <a href={`tel:${selected.phone}`} className="mt-2 block text-sm text-blue-600">单位电话：{selected.phone}</a>}<div className="mt-4 space-y-3">{selected.staff.length ? selected.staff.map((staff) => <div key={staff.appointmentId} className="border-t border-slate-100 pt-3"><p className="font-medium">{staff.name} · {staff.positionTitle}</p>{staff.phone ? <a href={`tel:${staff.phone}`} className="text-sm text-blue-600">{staff.phone}</a> : <p className="text-sm text-slate-400">暂无电话</p>}</div>) : <p className="text-sm text-slate-500">暂无当前在岗人员</p>}</div></div></>}</div>
  </section>;
}
