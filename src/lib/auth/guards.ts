import { redirect } from "next/navigation";
import { getCurrentSession } from "./current-session";
import { canAccessBusiness, type CurrentSession } from "@/modules/identity/session-service";

export async function requireBusinessPageSession(): Promise<CurrentSession> {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (session.accountStatus === "UNACTIVATED") redirect("/account/activate");
  if (session.forcePasswordChange) redirect("/account/change-password");
  if (!canAccessBusiness(session)) redirect("/login");
  return session;
}

export function isBootstrapAdmin(session: CurrentSession): boolean {
  // M0-004 replaces this deliberately narrow, default-deny bootstrap gate.
  return session.roles.some((role) => role === "ADMIN" || role === "SUPER_ADMIN");
}
