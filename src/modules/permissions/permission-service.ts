import type { CurrentSession } from "@/modules/identity/session-service";
import { resolvePermissionActor } from "./actor-resolver";
import { authorizeActor, type AuthorizeActorInput } from "./authorization";
import type { PermissionActor } from "./types";

export type AuthorizeInput = Omit<AuthorizeActorInput, "actor"> & {
  session: CurrentSession;
};

export async function authorize(input: AuthorizeInput) {
  const actor = await resolvePermissionActor(input.session);
  return authorizeActor({
    actor,
    action: input.action,
    resource: input.resource,
    relationPolicy: input.relationPolicy,
    statePolicy: input.statePolicy,
  });
}
export async function createPermissionRequest(session: CurrentSession) {
  const actorPromise = resolvePermissionActor(session);
  return {
    actor: () => actorPromise,
    authorize: async (input: Omit<AuthorizeActorInput, "actor">) => authorizeActor({
      ...input,
      actor: await actorPromise,
    }),
  };
}

export function hasCapability(actor: PermissionActor, action: AuthorizeActorInput["action"]): boolean {
  return actor.capabilities.has(action);
}
