import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { PasswordForm } from "@/components/auth/password-form";
import { getCurrentSession } from "@/lib/auth/current-session";

export default async function ActivatePage() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (session.accountStatus !== "UNACTIVATED") redirect(session.forcePasswordChange ? "/account/change-password" : "/");
  return (
    <AuthCard eyebrow="首次登录" title="激活账号" description="设置新密码并确认内部使用及信息保密说明后，方可进入业务页面。">
      <PasswordForm mode="activate" />
    </AuthCard>
  );
}
