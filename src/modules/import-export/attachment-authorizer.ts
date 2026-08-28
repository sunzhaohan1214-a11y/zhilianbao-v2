import { getPrismaClient } from "@/lib/db/prisma";
import type { AttachmentParentAuthorizerRegistry } from "@/modules/attachment/parent-authorization";

export function registerImportAttachmentAuthorizer(registry: AttachmentParentAuthorizerRegistry) {
  registry.register("IMPORT_BATCH", {
    authorize: async ({ actor, link }) => {
      if (link.relationType !== "SOURCE_FILE" || !actor.hasGlobalOperational || !actor.capabilities.has("import.execute")) return false;
      if (!actor.effectiveRoles.includes("ADMIN") && !actor.effectiveRoles.includes("SUPER_ADMIN")) return false;
      return await getPrismaClient().importBatch.count({ where: { id: link.entityId } }) === 1;
    },
  });
}
