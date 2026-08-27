import Link from "next/link";
import { TripForm, type TripFormValues } from "@/components/trip/trip-form";
import { tripPageContext } from "@/lib/trip/page-context";

function localInput(at: Date | null): string {
  if (!at) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(at);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}`;
}

export default async function EditTripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, service } = await tripPageContext();
  const trip = await service.get({ actor, tripId: id });
  if (trip.createdByPersonId !== actor.personId || ["COMPLETED", "CANCELED"].includes(trip.status)) {
    return <section><Link href={`/trips/${id}`} className="text-sm text-blue-700">‹ 返回行程</Link><p className="mt-6 rounded-2xl bg-white p-6 text-center">当前行程已锁定或不属于本人创建，不能编辑。</p></section>;
  }
  const initialValues: TripFormValues = {
    title: trip.title,
    purpose: trip.purpose,
    note: trip.note ?? "",
    overallEndAt: localInput(trip.overallEndAt),
    participantIds: [],
    nodes: trip.nodes.map((node) => ({
      plannedStartAt: localInput(node.plannedStartAt), plannedEndAt: localInput(node.plannedEndAt),
      enterpriseId: node.enterpriseId ?? "", locationName: node.locationName, address: node.address ?? "", content: node.content,
    })),
  };
  return <section><Link href={`/trips/${id}`} className="text-sm text-blue-700">‹ 返回行程</Link><h1 className="mt-4 text-2xl font-semibold">编辑工作行程</h1><TripForm tripId={id} initialValues={initialValues} /></section>;
}
