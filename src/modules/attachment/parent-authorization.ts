import type { AttachmentAccessAction, AttachmentLink } from "@/generated/prisma/client";
import type { PermissionActor } from "@/modules/permissions/types";

export type AttachmentParentAuthorizationInput = {
  actor: PermissionActor;
  link: Pick<AttachmentLink, "entityType" | "entityId" | "relationType">;
  action: AttachmentAccessAction;
};

export interface AttachmentParentAuthorizer {
  authorize(input: AttachmentParentAuthorizationInput): boolean | Promise<boolean>;
}

export class AttachmentParentAuthorizerRegistry {
  private readonly authorizers = new Map<string, AttachmentParentAuthorizer>();

  register(entityType: string, authorizer: AttachmentParentAuthorizer): void {
    if (!entityType || this.authorizers.has(entityType)) throw new Error("ATTACHMENT_PARENT_AUTHORIZER_ALREADY_REGISTERED");
    this.authorizers.set(entityType, authorizer);
  }

  async authorizeAll(input: {
    actor: PermissionActor;
    links: readonly Pick<AttachmentLink, "entityType" | "entityId" | "relationType">[];
    action: AttachmentAccessAction;
  }): Promise<boolean> {
    if (input.links.length === 0) return false;
    for (const link of input.links) {
      const authorizer = this.authorizers.get(link.entityType);
      if (!authorizer || !await authorizer.authorize({ actor: input.actor, link, action: input.action })) {
        return false;
      }
    }
    return true;
  }
}
