import Link from "next/link";
import { PresenceForm } from "@/components/presence/presence-form";
import { presencePageContext } from "@/lib/presence/page-context";
import { toShanghaiDateTimeLocal } from "@/modules/presence";

export default async function EditPresencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, service } = await presencePageContext();
  const report = await service.getMine({ actor, reportId: id });
  return <section><Link href="/presence" className="text-sm text-blue-700">‹ 返回来离宝</Link><h1 className="mt-4 text-2xl font-semibold">修改报备</h1>
    <PresenceForm reportId={id} initialValues={{
      arrivalAt: toShanghaiDateTimeLocal(report.arrivalAt),
      expectedDepartureAt: toShanghaiDateTimeLocal(report.expectedDepartureAt),
      origin: report.origin ?? "", transportMode: report.transportMode ?? "", trainFlightNo: report.trainFlightNo ?? "", note: report.note ?? "",
    }} />
  </section>;
}
