import { AdminTripCorrection, AdminVisitCorrection } from "@/components/trip/admin-trip-correction";
import { tripPageContext } from "@/lib/trip/page-context";
import { formatShanghai, TRIP_STATUS_LABEL } from "@/modules/trip";

export default async function AdminTripsPage() {
  const { actor, service } = await tripPageContext();
  const [trips, visits] = await Promise.all([
    service.list({ actor, query: { page: 1, pageSize: 100, participant: "ALL" } }),
    service.listVisits({ actor, page: 1, pageSize: 100 }),
  ]);
  return <section><p className="text-sm font-medium text-blue-600">工作动态</p><h1 className="mt-1 text-3xl font-semibold">行程与走访管理</h1><p className="mt-2 text-sm text-slate-500">纠错必须填写原因；完成后的节点与既有需求来源不会被静默覆盖。</p><h2 className="mt-8 text-xl font-semibold">行程</h2><div className="mt-4 grid gap-4">{trips.items.map((trip) => <article key={trip.id} className="rounded-2xl border bg-white p-5"><div className="flex justify-between gap-3"><strong>{trip.title}</strong><span className="text-sm text-blue-700">{TRIP_STATUS_LABEL[trip.status]}</span></div><p className="mt-2 text-sm text-slate-500">{formatShanghai(trip.nodes[0].plannedStartAt)} · {trip.nodes.map((node) => node.locationName).join(" → ")}</p><AdminTripCorrection trip={{ id: trip.id, title: trip.title, purpose: trip.purpose, note: trip.note }} /></article>)}</div><h2 className="mt-10 text-xl font-semibold">企业走访</h2><div className="mt-4 grid gap-4 md:grid-cols-2">{visits.items.map((visit) => <article key={visit.id} className="rounded-2xl border bg-white p-5"><strong>{visit.enterprise.name}</strong><p className="mt-2 text-sm text-slate-500">{formatShanghai(visit.visitedAt)} · {visit.trip.title}</p><p className="mt-2 text-sm">{visit.visitSummary || "暂无独立结果"}</p><p className="mt-2 text-xs text-slate-500">补充 {visit.supplements.length} 条 · 需求线索 {visit.demandLeads.length} 条</p><AdminVisitCorrection visit={{ id: visit.id, visitSummary: visit.visitSummary }} /></article>)}</div></section>;
}
