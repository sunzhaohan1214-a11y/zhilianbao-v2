import { getPrismaClient } from "@/lib/db/prisma";
import type { AttachmentParentAuthorizerRegistry } from "@/modules/attachment/parent-authorization";
import { canDownloadMonthlyReport, resolveMonthlyReportScope, scopeStillAllowed, type MonthlyReportScope } from "./reporting-scope";

function snapshotScope(value: unknown): MonthlyReportScope | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = value as Record<string, unknown>;
  if (typeof snapshot.countyWide !== "boolean" || !Array.isArray(snapshot.areaIds) || !snapshot.areaIds.every((item) => typeof item === "string")) return null;
  return snapshot.countyWide ? { countyWide: true, areaIds: [] } : { countyWide: false, areaIds: snapshot.areaIds as string[] };
}

export function registerMonthlyReportAttachmentAuthorizer(registry: AttachmentParentAuthorizerRegistry) {
  registry.register("MONTHLY_REPORT_EXPORT_TASK", { async authorize({ actor, link }) {
    if (link.relationType !== "OUTPUT") return false;
    const task = await getPrismaClient().monthlyReportExportTask.findUnique({ where: { id: link.entityId }, select: { createdByPersonId: true, status: true, scopeSnapshot: true } });
    if (!task || task.status !== "SUCCEEDED") return false;
    if (actor.hasSystem && actor.effectiveRoles.includes("SUPER_ADMIN")) return true;
    if (task.createdByPersonId !== actor.personId || !canDownloadMonthlyReport(actor)) return false;
    const snapshot = snapshotScope(task.scopeSnapshot);
    if (!snapshot) return false;
    try { return scopeStillAllowed(snapshot, resolveMonthlyReportScope(actor)); } catch { return false; }
  } });
}
