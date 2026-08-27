import { DemandLeadDetail } from "@/components/demand/demand-lead-detail";
import { demandLeadPageContext } from "@/lib/demand/page-context";

export default async function MobileDemandLeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { actor, service } = await demandLeadPageContext();
  if (!actor.capabilities.has("demand.lead.view")) {
    return <section className="rounded-3xl border border-red-200 bg-red-50 p-6"><p className="text-sm font-medium text-red-700">无权访问</p><h1 className="mt-2 text-2xl font-semibold">不能查看发布前需求线索</h1></section>;
  }
  const { id } = await params;
  const lead = await service.detail({ actor, leadId: id });
  return <DemandLeadDetail lead={lead} admin={false} />;
}
