import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { PasswordForm } from "@/components/auth/password-form";
import { getCurrentSession } from "@/lib/auth/current-session";

export default async function ChangePasswordPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (session.accountStatus === "UNACTIVATED") redirect("/account/activate");
  return (
    <AuthCard eyebrow={session.forcePasswordChange ? "安全要求" : "账号安全"} title={session.forcePasswordChange ? "请先修改密码" : "修改密码"} description={session.forcePasswordChange ? "临时密码登录后必须设置新密码，完成前不能访问业务。" : "修改后其他设备会退出，当前设备继续登录。"}>
      <PasswordForm mode="change" forceChange={session.forcePasswordChange} />
    </AuthCard>
  );
}
