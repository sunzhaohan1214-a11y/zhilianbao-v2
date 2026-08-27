import { DemandLeadDetail } from "@/components/demand/demand-lead-detail";
import { demandLeadPageContext } from "@/lib/demand/page-context";

export default async function AdminDemandLeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { actor, service } = await demandLeadPageContext();
  const { id } = await params;
  const lead = await service.detail({ actor, leadId: id });
  return <DemandLeadDetail lead={lead} admin />;
}
