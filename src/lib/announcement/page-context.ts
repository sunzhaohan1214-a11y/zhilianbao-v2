import { requireBusinessPageSession } from "@/lib/auth/guards";
import { AnnouncementService } from "@/modules/announcement/announcement-service";
import { NotificationService } from "@/modules/notification/notification-service";
import { resolvePermissionActor } from "@/modules/permissions/actor-resolver";

export async function announcementPageContext() {
  const actor = await resolvePermissionActor(await requireBusinessPageSession());
  return { actor, announcementService: new AnnouncementService(), notificationService: new NotificationService() };
}
