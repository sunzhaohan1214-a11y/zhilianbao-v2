import type { NextRequest } from "next/server";
import { requireRequestSession } from "@/lib/auth/current-session";
import { assertTrustedMutationOrigin } from "@/lib/auth/origin";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
import { HelpService } from "@/modules/help/help-service";
import { resolvePermissionActor } from "@/modules/permissions/actor-resolver";

export async function helpRequestContext(request: NextRequest, mutation = false) {
  if (mutation) assertTrustedMutationOrigin(request);
  const context = buildAuthRequestContext(request);
  const session = await requireRequestSession(request);
  const actor = await resolvePermissionActor(session);
  return { actor, context, service: new HelpService() };
}
