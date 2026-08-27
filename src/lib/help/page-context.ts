import { requireBusinessPageSession } from "@/lib/auth/guards";
import { HelpService } from "@/modules/help/help-service";
import { resolvePermissionActor } from "@/modules/permissions/actor-resolver";
export async function helpPageContext(){const session=await requireBusinessPageSession();return{actor:await resolvePermissionActor(session),service:new HelpService()};}
