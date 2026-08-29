import type { NextRequest } from "next/server";
import { requireRequestSession } from "@/lib/auth/current-session";
import { assertTrustedMutationOrigin } from "@/lib/auth/origin";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
import { ChatService } from "@/modules/ai/chat";
import { resolvePermissionActor } from "@/modules/permissions/actor-resolver";

export async function aiRequestContext(request: NextRequest) {
  assertTrustedMutationOrigin(request);
  const context = buildAuthRequestContext(request);
  const actor = await resolvePermissionActor(await requireRequestSession(request));
  return { actor, context, chat: new ChatService() };
}
