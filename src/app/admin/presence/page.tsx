import { AdminPresenceCorrectionForm } from "@/components/presence/admin-presence-correction-form";
import { presencePageContext } from "@/lib/presence/page-context";
import { formatShanghai, PRESENCE_STATUS_LABEL } from "@/modules/presence";

export default async function AdminPresencePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const { actor, service } = await presencePageContext();
  const value = (key: string) => typeof params[key] === "string" ? params[key] : undefined;
  const result = await service.adminHistory({ actor, query: {
    keyword: value("keyword") || undefined,
    status: value("status") || undefined,
    from: value("from") ? `${value("from")}:00+08:00` : undefined,
    to: value("to") ? `${value("to")}:00+08:00` : undefined,
    page: value("page") ?? "1",
    pageSize: "20",
  } });
  return <section>
    <div><p className="text-sm font-medium text-blue-600">工作动态</p><h1 className="mt-1 text-3xl font-semibold">来离宝管理</h1><p className="mt-2 text-sm text-slate-500">查看历史并依据线下核实结果正式纠错；不提供定位或轨迹。</p></div>
    <form className="mt-6 grid gap-3 rounded-2xl border bg-white p-4 md:grid-cols-5">
      <input name="keyword" defaultValue={value("keyword")} placeholder="人员姓名" className="rounded-xl border p-3" />
      <select name="status" defaultValue={value("status") ?? ""} className="rounded-xl border p-3"><option value="">全部状态</option><option value="FUTURE">未来安排</option><option value="IN_BAO">当前在宝</option><option value="ENDED">已结束</option><option value="CANCELED">已取消</option></select>
      <input aria-label="筛选开始时间" name="from" type="datetime-local" defaultValue={value("from")} className="rounded-xl border p-3" />
      <input aria-label="筛选结束时间" name="to" type="datetime-local" defaultValue={value("to")} className="rounded-xl border p-3" />
      <button className="rounded-xl bg-slate-900 text-white">筛选</button>
    </form>
    <div className="mt-5 overflow-x-auto rounded-2xl border bg-white"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr><th className="p-4">人员</th><th className="p-4">到宝</th><th className="p-4">预计离宝</th><th className="p-4">状态</th><th className="p-4">详情与纠错</th></tr></thead><tbody>
      {result.items.map((item) => <tr key={item.id} className="border-t align-top"><td className="p-4 font-medium">{item.person.name}</td><td className="p-4">{formatShanghai(item.arrivalAt)}</td><td className="p-4">{formatShanghai(item.expectedDepartureAt)}</td><td className="p-4">{PRESENCE_STATUS_LABEL[item.status]}</td><td className="p-4"><p className="max-w-xs text-slate-500">{[item.origin, item.transportMode, item.trainFlightNo, item.note].filter(Boolean).join(" · ") || "—"}</p>{item.cancelReason && <p className="mt-1 text-red-600">取消原因：{item.cancelReason}</p>}<AdminPresenceCorrectionForm reportId={item.id} /></td></tr>)}
    </tbody></table>{result.items.length === 0 && <p className="p-8 text-center text-slate-500">暂无符合条件的记录。</p>}</div>
    <p className="mt-3 text-sm text-slate-500">第 {result.page} 页，共 {result.total} 条</p>
  </section>;
}
