import type { NextRequest } from "next/server";
import { requireRequestSession } from "@/lib/auth/current-session";
import { assertTrustedMutationOrigin } from "@/lib/auth/origin";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
import { resolvePermissionActor } from "@/modules/permissions/actor-resolver";
import { ReportingService } from "@/modules/reporting/reporting-service";

export async function reportingRequestContext(request: NextRequest, mutation = false) {
  if (mutation) assertTrustedMutationOrigin(request);
  const context = buildAuthRequestContext(request);
  const actor = await resolvePermissionActor(await requireRequestSession(request));
  return { actor, context, service: new ReportingService() };
}
