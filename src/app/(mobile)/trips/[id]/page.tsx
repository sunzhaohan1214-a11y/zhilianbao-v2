import Link from "next/link";
import { TripActions } from "@/components/trip/trip-actions";
import { tripPageContext } from "@/lib/trip/page-context";
import { formatShanghai, TRIP_STATUS_LABEL } from "@/modules/trip";

export default async function TripDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, service } = await tripPageContext();
  const trip = await service.get({ actor, tripId: id });
  const isParticipant = trip.participants.some((item) => item.personId === actor.personId && item.leftAt === null);
  const canEdit = trip.createdByPersonId === actor.personId && !["COMPLETED", "CANCELED"].includes(trip.status);
  const isAdmin = actor.effectiveRoles.some((role) => role === "ADMIN" || role === "SUPER_ADMIN");
  const canCancel = trip.createdByPersonId === actor.personId || isAdmin;
  const canEditResult = Boolean(trip.result && (
    trip.createdByPersonId === actor.personId || trip.result.submittedByPersonId === actor.personId || isAdmin
  ));
  return (
    <section>
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href="/trips" className="text-sm text-blue-700">‹ 返回行程</Link>
          <h1 className="mt-3 text-2xl font-semibold">{trip.title}</h1>
          <p className="mt-2 text-sm text-neutral-500">{TRIP_STATUS_LABEL[trip.status]}</p>
        </div>
        {canEdit && <Link href={`/trips/${trip.id}/edit`} className="rounded-xl border bg-white px-3 py-2 text-sm">编辑</Link>}
      </div>
      <p className="mt-5 rounded-2xl bg-white p-5 text-sm leading-6 ring-1 ring-black/5">
        {trip.purpose}
        {trip.note && <span className="mt-2 block text-neutral-500">备注：{trip.note}</span>}
      </p>
      <section className="mt-6">
        <h2 className="font-semibold">行程节点</h2>
        <div className="mt-3 space-y-3">
          {trip.nodes.map((node) => (
            <article key={node.id} className="rounded-2xl bg-white p-5 ring-1 ring-black/5">
              <p className="text-sm font-medium">{node.sequenceNo}. {node.enterprise?.name ?? node.locationName}</p>
              <p className="mt-2 text-sm text-neutral-600">{formatShanghai(node.plannedStartAt)}{node.plannedEndAt ? ` — ${formatShanghai(node.plannedEndAt)}` : ""}</p>
              <p className="mt-2 text-sm">{node.content}</p>
              {node.address && <p className="mt-2 text-xs text-neutral-500">{node.address}</p>}
              {node.nodeResultSummary && <p className="mt-3 rounded-xl bg-blue-50 p-3 text-sm text-blue-900">节点结果：{node.nodeResultSummary}</p>}
            </article>
          ))}
        </div>
      </section>
      <section className="mt-6">
        <h2 className="font-semibold">参与人</h2>
        <p className="mt-3 rounded-2xl bg-white p-4 text-sm ring-1 ring-black/5">
          {trip.participants.map((participant) => `${participant.person.name}${participant.leftAt ? "（已退出）" : ""}`).join("、")}
        </p>
      </section>
      {trip.result && (
        <section className="mt-6 rounded-2xl bg-emerald-50 p-5">
          <h2 className="font-semibold text-emerald-900">总体结果</h2>
          <p className="mt-3 text-sm text-emerald-950">{trip.result.resultSummary}</p>
          {trip.result.nextStep && <p className="mt-2 text-sm text-emerald-800">下一步：{trip.result.nextStep}</p>}
          <p className="mt-3 text-xs text-emerald-700">{trip.result.submittedByPerson.name} · {formatShanghai(trip.result.submittedAt)}</p>
        </section>
      )}
      {trip.visits.length > 0 && (
        <section className="mt-6">
          <h2 className="font-semibold">企业走访</h2>
          {trip.visits.map((visit) => (
            <article key={visit.id} className="mt-3 rounded-2xl bg-white p-5 ring-1 ring-black/5">
              <strong>{visit.enterprise.name}</strong>
              <p className="mt-2 text-sm">{visit.visitSummary || "暂无独立走访结果"}</p>
              {visit.supplements.map((supplement) => (
                <p key={supplement.id} className="mt-3 border-l-2 border-blue-200 pl-3 text-sm">
                  <span className="text-neutral-500">{supplement.createdByPerson.name}：</span>{supplement.content}
                </p>
              ))}
              {visit.demandLeads.map((lead) => (
                <Link key={lead.id} href={`/demand-leads/${lead.id}`} className="mt-3 block text-sm text-amber-700">
                  需求线索 {lead.businessNo} · {lead.rawTitle}
                </Link>
              ))}
            </article>
          ))}
        </section>
      )}
      <TripActions
        tripId={trip.id}
        actorPersonId={actor.personId}
        status={trip.status}
        isParticipant={isParticipant}
        canCancel={canCancel}
        canSubmitResult={isParticipant || trip.createdByPersonId === actor.personId || isAdmin}
        canEditResult={canEditResult}
        canCreateLead={actor.capabilities.has("visit.demand_lead.create")}
        nodes={trip.nodes.map((node) => ({ id: node.id, label: node.enterprise?.name ?? node.locationName, enterprise: Boolean(node.enterpriseId) }))}
        visits={trip.visits.map((visit) => ({ id: visit.id, enterpriseName: visit.enterprise.name }))}
      />
    </section>
  );
}
