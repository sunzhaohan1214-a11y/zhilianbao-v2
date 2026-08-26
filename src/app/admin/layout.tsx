import type { ReactNode } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { isBootstrapAdmin, requireBusinessPageSession } from "@/lib/auth/guards";

export default async function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  const session = await requireBusinessPageSession();
  if (!isBootstrapAdmin(session)) {
    return (
      <main className="grid min-h-dvh place-items-center bg-slate-100 p-6">
        <section className="max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm font-medium text-red-600">无权访问</p>
          <h1 className="mt-2 text-2xl font-semibold">当前账号不能进入管理后台</h1>
          <p className="mt-3 text-slate-600">M0-003 临时安全边界仅允许有效 ADMIN 或 SUPER_ADMIN。</p>
        </section>
      </main>
    );
  }
  return <AdminShell>{children}</AdminShell>;
}
