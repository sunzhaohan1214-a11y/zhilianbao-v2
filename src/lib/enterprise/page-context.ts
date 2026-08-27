import { requireBusinessPageSession } from "@/lib/auth/guards";
import { resolvePermissionActor } from "@/modules/permissions/actor-resolver";
import { EnterpriseService } from "@/modules/enterprise";

export async function enterprisePageContext() {
  const session = await requireBusinessPageSession();
  return { actor: await resolvePermissionActor(session), service: new EnterpriseService() };
}
