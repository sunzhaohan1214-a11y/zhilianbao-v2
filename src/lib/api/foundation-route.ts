import type { NextRequest } from "next/server";
import { requireRequestSession } from "@/lib/auth/current-session";
import { assertTrustedMutationOrigin } from "@/lib/auth/origin";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
import { BatchService, MemberService, OrganizationService } from "@/modules/member-foundation";
import { resolvePermissionActor } from "@/modules/permissions/actor-resolver";

export async function foundationRequestContext(request: NextRequest, mutation = false) {
  if (mutation) assertTrustedMutationOrigin(request);
  const context = buildAuthRequestContext(request);
  const actor = await resolvePermissionActor(await requireRequestSession(request));
  return { actor, context, members: new MemberService(), batches: new BatchService(), organizations: new OrganizationService() };
}
