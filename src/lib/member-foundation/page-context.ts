import { requireBusinessPageSession } from "@/lib/auth/guards";
import { BatchService, MemberService, OrganizationService } from "@/modules/member-foundation";
import { resolvePermissionActor } from "@/modules/permissions/actor-resolver";
export async function memberFoundationPageContext() {
  const actor = await resolvePermissionActor(await requireBusinessPageSession());
  return { actor, members: new MemberService(), batches: new BatchService(), organizations: new OrganizationService() };
}
