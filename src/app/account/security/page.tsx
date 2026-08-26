import { SecurityPanel } from "@/components/auth/security-panel";
import { requireBusinessPageSession } from "@/lib/auth/guards";
import { listOwnSessions } from "@/modules/identity/auth-service";
import Link from "next/link";

export default async function SecurityPage() {
  const session = await requireBusinessPageSession();
  const sessions = (await listOwnSessions(session)).map((item) => ({
    ...item,
    createdAt: item.createdAt.toISOString(),
    expiresAt: item.expiresAt.toISOString(),
  }));
  return (
    <main className="mx-auto min-h-dvh max-w-[480px] bg-[#f5f5f7] px-5 py-8">
      <p className="text-sm font-medium text-blue-600">账号安全</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">登录设备</h1>
      <p className="mt-2 mb-6 text-sm leading-6 text-neutral-500">同一账号最多保留2台有效设备。撤销当前设备后需要重新登录。</p>
      <Link href="/account/change-password" className="mb-5 block rounded-2xl bg-white p-4 font-medium text-blue-600 shadow-sm ring-1 ring-black/5">修改登录密码</Link>
      <SecurityPanel initialSessions={sessions} />
    </main>
  );
}
