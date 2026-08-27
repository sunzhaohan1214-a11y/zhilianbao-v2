import Link from "next/link";
import { presencePageContext } from "@/lib/presence/page-context";
import { formatShanghai } from "@/modules/presence";

export default async function CurrentPresencePage() {
  const { actor, service } = await presencePageContext();
  const summary = await service.current({ actor });
  return <section><Link href="/presence" className="text-sm text-blue-700">‹ 返回来离宝</Link>
    <h1 className="mt-4 text-2xl font-semibold">当前在宝</h1>
    <div className="mt-5 rounded-3xl bg-white p-5 ring-1 ring-black/5"><p className="text-4xl font-semibold">{summary.total}</p><p className="mt-2 text-sm text-neutral-500">在任 {summary.currentCount} · 往届 {summary.alumniCount}</p></div>
    <div className="mt-4 space-y-3">{summary.items.map((item) => <article key={item.person.id} className="rounded-2xl bg-white p-4 ring-1 ring-black/5">
      <div className="flex justify-between"><strong>{item.person.name}</strong><span className="text-xs text-neutral-500">{item.person.memberType === "CURRENT" ? "在任" : "往届"}</span></div>
      <p className="mt-2 text-sm text-neutral-600">{formatShanghai(item.arrivalAt)} — {formatShanghai(item.expectedDepartureAt)}</p>
    </article>)}{summary.items.length === 0 && <div className="rounded-2xl bg-white p-8 text-center text-sm text-neutral-500">当前暂无在宝人员。</div>}</div>
  </section>;
}
