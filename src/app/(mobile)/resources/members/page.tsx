import Link from "next/link";
import { memberFoundationPageContext } from "@/lib/member-foundation/page-context";
export default async function MembersPage({ searchParams }: { searchParams: Promise<{ kind?: string; keyword?: string }> }) {
  const params = await searchParams; const kind = params.kind === "alumni" ? "alumni" : "current";
  const { actor, members } = await memberFoundationPageContext();
  const result = await members.list({ actor, query: { kind, keyword: params.keyword?.trim() || undefined, page: 1, pageSize: 100 } });
  return <section><h1 className="text-2xl font-semibold">团员</h1><p className="mt-2 text-sm text-slate-500">Person 永久保留，多批次履历不会复制人员。</p>
    <nav className="mt-4 flex gap-2"><Link href="/resources/members?kind=current" className={`rounded-full px-4 py-2 text-sm ${kind === "current" ? "bg-blue-600 text-white" : "bg-white"}`}>在任</Link><Link href="/resources/members?kind=alumni" className={`rounded-full px-4 py-2 text-sm ${kind === "alumni" ? "bg-blue-600 text-white" : "bg-white"}`}>往届</Link></nav>
    <form className="mt-4 flex gap-2"><input type="hidden" name="kind" value={kind} /><input name="keyword" defaultValue={params.keyword} placeholder="搜索姓名" className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white p-3" /><button className="rounded-xl bg-slate-900 px-4 text-sm text-white">搜索</button></form>
    <div className="mt-4 space-y-3">{result.items.length ? result.items.map((member) => <Link key={member.id} href={`/resources/members/${member.id}`} className="block rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><strong>{member.name}</strong><span className="text-blue-600">›</span></div><p className="mt-1 text-sm text-slate-500">{member.memberships[0]?.postOrganization?.name ?? member.memberships[0]?.dispatchOrganization?.name ?? "暂无单位"}</p><div className="mt-2 flex gap-2">{member.roles.filter(({ code }) => code === "GROUP_LEADER" || code === "MINISTER").map((role) => <span key={role.code} className="rounded-full bg-blue-50 px-2 py-1 text-xs text-blue-700">{role.label}</span>)}</div></Link>) : <p className="rounded-2xl bg-white p-6 text-center text-sm text-slate-500">暂无{kind === "current" ? "在任" : "往届"}团员</p>}</div>
  </section>;
}
