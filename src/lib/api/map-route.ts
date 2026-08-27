import type { NextRequest } from "next/server";
import { requireRequestSession } from "@/lib/auth/current-session";
import { assertTrustedMutationOrigin } from "@/lib/auth/origin";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
import { MapService } from "@/modules/map/map-service";
import { resolvePermissionActor } from "@/modules/permissions/actor-resolver";
export async function mapRequestContext(request: NextRequest, mutation = false) {
  if (mutation) assertTrustedMutationOrigin(request);
  const context = buildAuthRequestContext(request);
  const actor = await resolvePermissionActor(await requireRequestSession(request));
  return { context, actor, maps: new MapService() };
}
