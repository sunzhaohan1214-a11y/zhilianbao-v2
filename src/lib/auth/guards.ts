import { redirect } from "next/navigation";
import { getCurrentSession } from "./current-session";
import { canAccessBusiness, type CurrentSession } from "@/modules/identity/session-service";
import { authorize } from "@/modules/permissions/permission-service";

export async function requireBusinessPageSession(): Promise<CurrentSession> {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (session.accountStatus === "UNACTIVATED") redirect("/account/activate");
  if (session.forcePasswordChange) redirect("/account/change-password");
  if (!canAccessBusiness(session)) redirect("/login");
  return session;
}

export async function requireAdminShellPermission(session: CurrentSession) {
  return authorize({ session, action: "admin.shell.access" });
}
