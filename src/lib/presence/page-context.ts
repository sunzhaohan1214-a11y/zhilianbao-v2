import { requireBusinessPageSession } from "@/lib/auth/guards";
import { resolvePermissionActor } from "@/modules/permissions/actor-resolver";
import { PresenceService } from "@/modules/presence";

export async function presencePageContext() {
  const session = await requireBusinessPageSession();
  return { actor: await resolvePermissionActor(session), service: new PresenceService() };
}
