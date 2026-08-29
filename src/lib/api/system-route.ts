import type { NextRequest } from "next/server";
import { requireRequestSession } from "@/lib/auth/current-session";
import { assertTrustedMutationOrigin } from "@/lib/auth/origin";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
import { resolvePermissionActor } from "@/modules/permissions/actor-resolver";
import { AIConfigService, AuditQueryService, BackupService, HealthService, RestoreService, SettingsService, WorkCalendarService } from "@/modules/system";
export async function systemRequestContext(request: NextRequest, mutation = false) { if (mutation) assertTrustedMutationOrigin(request); const context = buildAuthRequestContext(request); const actor = await resolvePermissionActor(await requireRequestSession(request)); return { actor, context, settings: new SettingsService(), calendar: new WorkCalendarService(), backups: new BackupService(), restores: new RestoreService(), audit: new AuditQueryService(), health: new HealthService(), ai: new AIConfigService() }; }
