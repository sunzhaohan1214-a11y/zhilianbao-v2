import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { LoginForm } from "@/components/auth/login-form";
import { getCurrentSession } from "@/lib/auth/current-session";
import { canAccessBusiness } from "@/modules/identity/session-service";

export default async function LoginPage() {
  const session = await getCurrentSession();
  if (session?.accountStatus === "UNACTIVATED") redirect("/account/activate");
  if (session?.forcePasswordChange) redirect("/account/change-password");
  if (session && canAccessBusiness(session)) redirect("/");
  return (
    <AuthCard eyebrow="ZHILIANBAO" title="登录智链宝" description="使用管理员为您开通的手机号和密码登录。">
      <LoginForm adminContactPhone={process.env.ADMIN_CONTACT_PHONE ?? "0514-XXXXXXXX"} />
    </AuthCard>
  );
}
