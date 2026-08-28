import type { ReactNode } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { requireAdminShellPermission, requireBusinessPageSession } from "@/lib/auth/guards";
import { isPermissionError } from "@/modules/permissions/permission-errors";

export default async function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  const session = await requireBusinessPageSession();
  let capabilities: string[] = [];
  try {
    const authorization = await requireAdminShellPermission(session);
    capabilities = [...authorization.actor.capabilities];
  } catch (error) {
    if (!isPermissionError(error)) throw error;
    return (
      <main className="grid min-h-dvh place-items-center bg-slate-100 p-6">
        <section className="max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm font-medium text-red-600">无权访问</p>
          <h1 className="mt-2 text-2xl font-semibold">当前账号不能进入管理后台</h1>
          <p className="mt-3 text-slate-600">统一权限服务仅允许具备管理后台能力的账号进入。</p>
        </section>
      </main>
    );
  }
  return <AdminShell capabilities={capabilities}>{children}</AdminShell>;
}
