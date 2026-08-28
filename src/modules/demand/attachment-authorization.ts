import { getPrismaClient } from "@/lib/db/prisma";
import type { AttachmentParentAuthorizerRegistry } from "@/modules/attachment/parent-authorization";
import { DEMAND_ENTITY, DEMAND_LEAD_ENTITY } from "./constants";

export function registerDemandAttachmentAuthorizers(registry: AttachmentParentAuthorizerRegistry): void {
  registry.register(DEMAND_LEAD_ENTITY, {
    async authorize({ actor, link }) {
      if (!actor.capabilities.has("demand.lead.view")) return false;
      const lead = await getPrismaClient().demandLead.findUnique({
        where: { id: link.entityId },
        select: { responsibleAreaId: true },
      });
      if (!lead) return false;
      return actor.hasGlobalOperational || actor.townshipAreaIds.includes(lead.responsibleAreaId);
    },
  });

  registry.register(DEMAND_ENTITY, {
    async authorize({ actor, link }) {
      const demand = await getPrismaClient().demand.findUnique({
        where: { id: link.entityId },
        select: { responsibleAreaId: true, status: true },
      });
      if (!demand) return false;
      if (["DRAFT", "RETURNED", "PENDING_REVIEW"].includes(demand.status)) {
        return actor.capabilities.has("demand.lead.view")
          && (actor.hasGlobalOperational || actor.townshipAreaIds.includes(demand.responsibleAreaId));
      }
      return actor.capabilities.has("demand.view") && actor.hasGlobalPublished;
    },
  });

  registry.register("DEMAND_PROGRESS", {
    async authorize({ actor, link }) {
      if (!actor.capabilities.has("demand.view") || !actor.hasGlobalPublished) return false;
      const progress = await getPrismaClient().demandProgress.findUnique({
        where: { id: link.entityId },
        select: { demand: { select: { status: true } } },
      });
      return Boolean(progress && !["DRAFT", "RETURNED", "PENDING_REVIEW"].includes(progress.demand.status));
    },
  });

  registry.register("DEMAND_CLOSE_REQUEST", {
    async authorize({ actor, link }) {
      if (!actor.capabilities.has("demand.view") || !actor.hasGlobalPublished) return false;
      const request = await getPrismaClient().demandCloseRequest.findUnique({
        where: { id: link.entityId },
        select: { demand: { select: { status: true } } },
      });
      return Boolean(request && !["DRAFT", "RETURNED", "PENDING_REVIEW"].includes(request.demand.status));
    },
  });
}
