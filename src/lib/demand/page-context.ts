import { requireBusinessPageSession } from "@/lib/auth/guards";
import { DemandLeadService } from "@/modules/demand";
import { resolvePermissionActor } from "@/modules/permissions/actor-resolver";

export async function demandLeadPageContext() {
  const session = await requireBusinessPageSession();
  return { actor: await resolvePermissionActor(session), service: new DemandLeadService() };
}
