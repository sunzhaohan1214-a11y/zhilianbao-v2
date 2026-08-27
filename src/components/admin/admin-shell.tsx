import type { ReactNode } from "react";
import Link from "next/link";

export function AdminShell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="min-h-dvh bg-slate-50 lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="border-b border-slate-200 bg-white px-6 py-6 text-slate-950 lg:border-b-0 lg:border-r">
        <p className="text-xs font-medium tracking-[0.2em] text-blue-600">ZHILIANBAO</p>
        <p className="mt-2 text-xl font-semibold">PC 管理后台</p>
        <nav className="mt-8 space-y-1 text-sm">
          <Link className="block rounded-xl px-3 py-2 hover:bg-blue-50 hover:text-blue-700" href="/admin">工作台</Link>
          <Link className="block rounded-xl px-3 py-2 hover:bg-blue-50 hover:text-blue-700" href="/admin/demands">正式需求</Link>
          <Link className="block rounded-xl px-3 py-2 hover:bg-blue-50 hover:text-blue-700" href="/admin/demand-leads">需求线索</Link>
          <Link className="block rounded-xl px-3 py-2 hover:bg-blue-50 hover:text-blue-700" href="/admin/help-requests">办事求助</Link>
          <Link className="block rounded-xl px-3 py-2 hover:bg-blue-50 hover:text-blue-700" href="/admin/announcements">公告治理</Link>
          <Link className="block rounded-xl px-3 py-2 hover:bg-blue-50 hover:text-blue-700" href="/admin/enterprises">企业管理</Link>
          <Link className="block rounded-xl px-3 py-2 hover:bg-blue-50 hover:text-blue-700" href="/admin/enterprise-change-requests">企业申请审核</Link>
          <Link className="block rounded-xl px-3 py-2 hover:bg-blue-50 hover:text-blue-700" href="/admin/talents">人才管理</Link>
          <Link className="block rounded-xl px-3 py-2 hover:bg-blue-50 hover:text-blue-700" href="/admin/talent-change-requests">人才申请审核</Link>
          <Link className="block rounded-xl px-3 py-2 hover:bg-blue-50 hover:text-blue-700" href="/admin/members">人员与团员</Link>
          <Link className="block rounded-xl px-3 py-2 hover:bg-blue-50 hover:text-blue-700" href="/admin/batches">批次与团长</Link>
          <Link className="block rounded-xl px-3 py-2 hover:bg-blue-50 hover:text-blue-700" href="/admin/organizations">组织与任职</Link>
          <Link className="block rounded-xl px-3 py-2 hover:bg-blue-50 hover:text-blue-700" href="/admin/maps">地图治理</Link>
          <Link className="block rounded-xl px-3 py-2 hover:bg-blue-50 hover:text-blue-700" href="/admin/presence">来离宝管理</Link>
          <Link className="block rounded-xl px-3 py-2 hover:bg-blue-50 hover:text-blue-700" href="/admin/policies">政策治理</Link>
        </nav>
      </aside>
      <main className="p-6 lg:p-10">{children}</main>
    </div>
  );
}
