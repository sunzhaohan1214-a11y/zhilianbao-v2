import { requireBusinessPageSession } from "@/lib/auth/guards";
import { resolvePermissionActor } from "@/modules/permissions/actor-resolver";
import { TalentService } from "@/modules/talent";
export async function talentPageContext(){const session=await requireBusinessPageSession();return{actor:await resolvePermissionActor(session),service:new TalentService()};}
