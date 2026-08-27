import { requireBusinessPageSession } from "@/lib/auth/guards";
import { DemandRecommendationService, FormalDemandService } from "@/modules/demand";
import { resolvePermissionActor } from "@/modules/permissions/actor-resolver";

export async function formalDemandPageContext() {
  const session = await requireBusinessPageSession();
  return {
    actor: await resolvePermissionActor(session),
    service: new FormalDemandService(),
    recommendationService: new DemandRecommendationService(),
  };
}
