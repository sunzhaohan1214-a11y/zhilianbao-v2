import { getPrismaClient } from "@/lib/db/prisma";
import type { AttachmentParentAuthorizerRegistry } from "@/modules/attachment/parent-authorization";
import { authorizeActor } from "@/modules/permissions/authorization";

export function registerPolicyAttachmentAuthorizer(registry: AttachmentParentAuthorizerRegistry) {
  registry.register("POLICY_CONTENT_VERSION", {
    async authorize({ actor, link }) {
      const version = await getPrismaClient().policyContentVersion.findUnique({
        where: { id: link.entityId },
        select: { policy: { select: { publicationStatus: true } } },
      });
      if (!version) return false;
      try {
        await authorizeActor({
          actor,
          action: version.policy.publicationStatus === "PUBLISHED" ? "policy.view" : "policy.edit",
          resource: { resourceType: "policy", requiredScope: version.policy.publicationStatus === "PUBLISHED" ? "GLOBAL_PUBLISHED" : "GLOBAL_OPERATIONAL" },
        });
        return true;
      } catch {
        return false;
      }
    },
  });
}
