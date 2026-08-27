import { requireBusinessPageSession } from "@/lib/auth/guards";
import { MapService } from "@/modules/map/map-service";
import { resolvePermissionActor } from "@/modules/permissions/actor-resolver";
export async function mapPageContext() { const actor = await resolvePermissionActor(await requireBusinessPageSession()); return { actor, maps: new MapService() }; }
