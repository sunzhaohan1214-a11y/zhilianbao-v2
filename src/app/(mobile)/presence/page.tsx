import Link from "next/link";
import { PresenceCancelForm } from "@/components/presence/presence-cancel-form";
import { presencePageContext } from "@/lib/presence/page-context";
import { formatShanghai, PRESENCE_STATUS_LABEL } from "@/modules/presence";

export default async function PresencePage() {
  const { actor, service } = await presencePageContext();
  const canReport = actor.capabilities.has("presence.report.self") && actor.capabilities.has("presence.history.self_view");
  const items = canReport ? await service.listMine({ actor }) : [];
  const now = new Date();
  return <section>
    <div className="flex items-start justify-between gap-3">
      <div><p className="text-sm font-medium text-blue-600">我的 · 工作</p><h1 className="mt-1 text-2xl font-semibold">来离宝</h1></div>
      <Link href="/presence/current" className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm">当前在宝</Link>
    </div>
    <p className="mt-3 text-sm text-neutral-500">一张完整报备，不是考勤；系统不请求定位。</p>
    {canReport && <Link href="/presence/new" className="mt-5 block rounded-2xl bg-blue-600 px-4 py-3 text-center font-medium text-white">新增来离宝报备</Link>}
    {!canReport && <div className="mt-6 rounded-2xl bg-white p-5 text-sm text-neutral-600 ring-1 ring-black/5">当前身份可查看在宝名单，但不能填报个人来离宝记录。</div>}
    <div className="mt-6 space-y-3">
      {items.map((item) => {
        const editable = !item.canceledAt && item.expectedDepartureAt > now;
        return <article key={item.id} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
          <div className="flex items-center justify-between gap-3"><strong>{PRESENCE_STATUS_LABEL[item.status]}</strong><span className="text-xs text-neutral-500">北京时间</span></div>
          <p className="mt-3 text-sm">{formatShanghai(item.arrivalAt)} — {formatShanghai(item.expectedDepartureAt)}</p>
          {(item.origin || item.transportMode || item.trainFlightNo) && <p className="mt-2 text-sm text-neutral-500">{[item.origin, item.transportMode, item.trainFlightNo].filter(Boolean).join(" · ")}</p>}
          {item.note && <p className="mt-2 text-sm text-neutral-600">{item.note}</p>}
          {item.cancelReason && <p className="mt-2 text-sm text-red-600">取消原因：{item.cancelReason}</p>}
          {editable && <div className="mt-3 border-t border-black/5 pt-3">
            <Link href={`/presence/${item.id}/edit`} className="text-sm font-medium text-blue-700">修改记录</Link>
            <PresenceCancelForm reportId={item.id} />
          </div>}
        </article>;
      })}
      {canReport && items.length === 0 && <div className="rounded-2xl bg-white p-8 text-center text-sm text-neutral-500 ring-1 ring-black/5">暂无来离宝记录，可提前填报未来安排。</div>}
    </div>
  </section>;
}
