import Link from "next/link";
import { tripPageContext } from "@/lib/trip/page-context";
import { formatShanghai, TRIP_STATUS_LABEL } from "@/modules/trip";

export default async function TripsPage() {
  const { actor, service } = await tripPageContext();
  const now = new Date();
  const result = await service.list({ actor, query: { page: 1, pageSize: 100, participant: "ME" }, now });
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
  const todayItems = result.items.filter((trip) => trip.nodes.some((node) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(node.plannedStartAt) === todayKey));
  const todayIds = new Set(todayItems.map(({ id }) => id));
  const groups = [
    { title: "今天", items: todayItems },
    { title: "即将开始", items: result.items.filter((trip) => trip.status === "PLANNED" && !todayIds.has(trip.id)) },
    { title: "待补结果", items: result.items.filter((trip) => trip.status === "PENDING_RESULT" && !todayIds.has(trip.id)) },
    { title: "历史", items: result.items.filter((trip) => ["COMPLETED", "CANCELED"].includes(trip.status) && !todayIds.has(trip.id)) },
  ];
  const canCreate = actor.capabilities.has("trip.create.self") || actor.capabilities.has("trip.create.shared") || actor.capabilities.has("trip.create.team");
  const days = Array.from({ length: 7 }, (_, index) => new Date(now.getTime() + index * 86400000));
  return <section><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium text-blue-600">我的 · 工作</p><h1 className="mt-1 text-2xl font-semibold">工作行程</h1></div>{canCreate && <Link href="/trips/new" className="min-h-11 content-center rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white">新建</Link>}</div><div className="mt-5 grid grid-cols-7 gap-1 rounded-2xl bg-white p-2 text-center text-xs ring-1 ring-black/5">{days.map((day) => <div key={day.toISOString()} className="rounded-xl px-1 py-2 first:bg-blue-50 first:text-blue-700"><span className="block text-neutral-500">{new Intl.DateTimeFormat("zh-CN", { weekday: "short", timeZone: "Asia/Shanghai" }).format(day)}</span><strong className="mt-1 block">{new Intl.DateTimeFormat("zh-CN", { day: "numeric", timeZone: "Asia/Shanghai" }).format(day)}</strong></div>)}</div><p className="mt-3 text-xs text-neutral-500">一周日期条用于快速识别；共享行程只展示一次，不建设复杂月历。</p>{groups.map((group) => <section key={group.title} className="mt-7"><h2 className="text-sm font-semibold text-neutral-500">{group.title}</h2><div className="mt-3 space-y-3">{group.items.map((trip) => <Link key={trip.id} href={`/trips/${trip.id}`} className="block rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5"><div className="flex items-center justify-between gap-3"><strong>{trip.title}</strong><span className="text-xs text-blue-700">{TRIP_STATUS_LABEL[trip.status]}</span></div><p className="mt-2 text-sm text-neutral-600">{formatShanghai(trip.nodes[0].plannedStartAt)} · {trip.nodes.map((node) => node.locationName).join(" → ")}</p><p className="mt-2 text-xs text-neutral-500">{trip.participants.filter(({ leftAt }) => leftAt === null).map(({ person }) => person.name).join("、")}</p></Link>)}{group.items.length === 0 && <div className="rounded-2xl bg-white p-5 text-sm text-neutral-500 ring-1 ring-black/5">暂无记录</div>}</div></section>)}</section>;
}
