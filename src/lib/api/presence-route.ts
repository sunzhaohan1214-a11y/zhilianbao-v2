import type { NextRequest } from "next/server";
import { requireRequestSession } from "@/lib/auth/current-session";
import { assertTrustedMutationOrigin } from "@/lib/auth/origin";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
import { resolvePermissionActor } from "@/modules/permissions/actor-resolver";
import { PresenceService } from "@/modules/presence";

export async function presenceRequestContext(request: NextRequest, mutation = false) {
  if (mutation) assertTrustedMutationOrigin(request);
  const context = buildAuthRequestContext(request);
  const session = await requireRequestSession(request);
  const actor = await resolvePermissionActor(session);
  return { actor, context, service: new PresenceService() };
}
