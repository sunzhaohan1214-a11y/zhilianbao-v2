import { getPrismaClient } from "@/lib/db/prisma";
import type { AttachmentParentAuthorizerRegistry } from "@/modules/attachment/parent-authorization";
import { authorizeActor } from "@/modules/permissions/authorization";

export function registerPolicyAttachmentAuthorizer(registry: AttachmentParentAuthorizerRegistry) {
  registry.register("POLICY_CONTENT_VERSION", {
    async authorize({ actor, link }) {
      const version = await getPrismaClient().policyContentVersion.findUnique({
        where: { id: link.entityId },
        select: { policy: { select: { publicationStatus: true, currentVersionId: true } } },
      });
      if (!version) return false;
      try {
        if (actor.capabilities.has("policy.edit")) {
          await authorizeActor({ actor, action: "policy.edit", resource: { resourceType: "policy", requiredScope: "GLOBAL_OPERATIONAL" } });
          return true;
        }
        if (version.policy.publicationStatus !== "PUBLISHED" || version.policy.currentVersionId !== link.entityId) return false;
        await authorizeActor({
          actor,
          action: "policy.view",
          resource: { resourceType: "policy", requiredScope: "GLOBAL_PUBLISHED" },
        });
        return true;
      } catch {
        return false;
      }
    },
  });
}
