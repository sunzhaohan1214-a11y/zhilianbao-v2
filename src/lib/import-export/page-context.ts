import { requireBusinessPageSession } from "@/lib/auth/guards";
import { resolvePermissionActor } from "@/modules/permissions/actor-resolver";
import { ImportService } from "@/modules/import-export/import-service";
export async function importPageContext() { const session = await requireBusinessPageSession(); const actor = await resolvePermissionActor(session); return { actor, service: new ImportService() }; }
