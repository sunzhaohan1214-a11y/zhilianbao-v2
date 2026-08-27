import type { NextRequest } from "next/server";
import { requireRequestSession } from "@/lib/auth/current-session";
import { assertTrustedMutationOrigin } from "@/lib/auth/origin";
import { NotificationService } from "@/modules/notification/notification-service";
import { resolvePermissionActor } from "@/modules/permissions/actor-resolver";

export async function notificationRequestContext(request: NextRequest, mutation = false) {
  if (mutation) assertTrustedMutationOrigin(request);
  const actor = await resolvePermissionActor(await requireRequestSession(request));
  return { actor, service: new NotificationService() };
}
