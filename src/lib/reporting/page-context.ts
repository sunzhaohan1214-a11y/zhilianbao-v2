import { requireBusinessPageSession } from "@/lib/auth/guards";
import { resolvePermissionActor } from "@/modules/permissions/actor-resolver";
import { ReportingService } from "@/modules/reporting/reporting-service";

export async function reportingPageContext() {
  const actor = await resolvePermissionActor(await requireBusinessPageSession());
  return { actor, service: new ReportingService() };
}
