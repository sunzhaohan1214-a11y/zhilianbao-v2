import { requireBusinessPageSession } from "@/lib/auth/guards";
import { resolvePermissionActor } from "@/modules/permissions/actor-resolver";
import { PolicyService } from "@/modules/policy";

export async function policyPageContext() {
  const session = await requireBusinessPageSession();
  return { actor: await resolvePermissionActor(session), service: new PolicyService() };
}
