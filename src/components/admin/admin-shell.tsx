import type { ReactNode } from "react";

export function AdminShell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="min-h-dvh bg-slate-100 lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="border-b border-slate-200 bg-slate-950 px-6 py-6 text-white lg:border-b-0 lg:border-r">
        <p className="text-xs font-medium tracking-[0.2em] text-blue-300">ZHILIANBAO</p>
        <p className="mt-2 text-xl font-semibold">PC 管理后台</p>
        <p className="mt-8 text-sm text-slate-400">工程骨架</p>
      </aside>
      <main className="p-6 lg:p-10">{children}</main>
    </div>
  );
}
