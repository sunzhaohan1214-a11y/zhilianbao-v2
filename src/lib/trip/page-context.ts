import { requireBusinessPageSession } from "@/lib/auth/guards";
import { resolvePermissionActor } from "@/modules/permissions/actor-resolver";
import { TripService } from "@/modules/trip";

export async function tripPageContext() {
  const session = await requireBusinessPageSession();
  return { actor: await resolvePermissionActor(session), service: new TripService() };
}
