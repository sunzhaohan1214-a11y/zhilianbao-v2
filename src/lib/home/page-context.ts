import { requireBusinessPageSession } from "@/lib/auth/guards";
import { HomeService } from "@/modules/home";
import { resolvePermissionActor } from "@/modules/permissions/actor-resolver";

export async function homePageContext(now = new Date()) {
  const session = await requireBusinessPageSession();
  const actor = await resolvePermissionActor(session, now);
  return { actor, service: new HomeService() };
}
