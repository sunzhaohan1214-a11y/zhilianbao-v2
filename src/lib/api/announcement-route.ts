import type { NextRequest } from "next/server";
import { requireRequestSession } from "@/lib/auth/current-session";
import { assertTrustedMutationOrigin } from "@/lib/auth/origin";
import { AnnouncementService } from "@/modules/announcement/announcement-service";
import { resolvePermissionActor } from "@/modules/permissions/actor-resolver";

export async function announcementRequestContext(request: NextRequest, mutation = false) {
  if (mutation) assertTrustedMutationOrigin(request);
  const actor = await resolvePermissionActor(await requireRequestSession(request));
  return { actor, service: new AnnouncementService() };
}
