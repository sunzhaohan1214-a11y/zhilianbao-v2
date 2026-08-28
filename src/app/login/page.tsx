import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { LoginForm } from "@/components/auth/login-form";
import { getCurrentSession } from "@/lib/auth/current-session";
import { canAccessBusiness } from "@/modules/identity/session-service";
import { getPublicAdminContactPhone } from "@/modules/system/settings-service";

export default async function LoginPage() {
  const session = await getCurrentSession();
  if (session?.accountStatus === "UNACTIVATED") redirect("/account/activate");
  if (session?.forcePasswordChange) redirect("/account/change-password");
  if (session && canAccessBusiness(session)) redirect("/");
  const adminContactPhone = await getPublicAdminContactPhone();
  return (
    <AuthCard eyebrow="ZHILIANBAO" title="登录智链宝" description="使用管理员为您开通的手机号和密码登录。">
      <LoginForm adminContactPhone={adminContactPhone} />
    </AuthCard>
  );
}
