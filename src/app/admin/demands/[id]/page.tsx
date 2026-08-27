import { notFound } from "next/navigation";
import { FormalDemandDetail } from "@/components/demand/formal-demand-detail";
import { formalDemandPageAccess } from "@/lib/demand/formal-page-access";
import { formalDemandPageContext } from "@/lib/demand/formal-page-context";
import { formalDemandDraftEditSource, isDemandError } from "@/modules/demand";

export default async function AdminFormalDemandDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, service, recommendationService } = await formalDemandPageContext();
  let loaded;
  try {
    const [demand, timeline] = await Promise.all([service.detail({ actor, demandId: id }), service.timeline({ actor, demandId: id })]);
    const access = formalDemandPageAccess(actor, demand);
    const editSource = formalDemandDraftEditSource(actor, demand, demand.provenances.map(({ sourceType }) => sourceType));
    const options = access.canEdit && editSource ? await service.formOptions({ actor, sourceType: editSource }) : { areas: [] };
    const recommendations = demand.firstPublishedAt ? await recommendationService.getRecommendations({ actor, demandId: id }) : null;
    loaded = { demand, timeline, access, areas: options.areas, recommendations };
  } catch (error) {
    if (isDemandError(error) && error.status === 404) notFound();
    throw error;
  }
  return <FormalDemandDetail demand={loaded.demand} timeline={loaded.timeline} areas={loaded.areas} recommendations={loaded.recommendations} {...loaded.access}/>;
}
