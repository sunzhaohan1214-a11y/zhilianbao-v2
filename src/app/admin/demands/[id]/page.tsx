import { notFound } from "next/navigation";
import { FormalDemandDetail } from "@/components/demand/formal-demand-detail";
import { formalDemandPageAccess } from "@/lib/demand/formal-page-access";
import { formalDemandPageContext } from "@/lib/demand/formal-page-context";
import { isDemandError } from "@/modules/demand";

export default async function AdminFormalDemandDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, service } = await formalDemandPageContext();
  let loaded;
  try {
    const [demand, timeline] = await Promise.all([service.detail({ actor, demandId: id }), service.timeline({ actor, demandId: id })]);
    const access = formalDemandPageAccess(actor, demand);
    const options = access.canEdit ? await service.formOptions({ actor }) : { areas: [] };
    loaded = { demand, timeline, access, areas: options.areas };
  } catch (error) {
    if (isDemandError(error) && error.status === 404) notFound();
    throw error;
  }
  return <FormalDemandDetail demand={loaded.demand} timeline={loaded.timeline} areas={loaded.areas} {...loaded.access}/>;
}
