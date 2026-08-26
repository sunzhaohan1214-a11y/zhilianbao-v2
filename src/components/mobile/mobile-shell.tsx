import type { ReactNode } from "react";
import { MobileTabBar } from "./mobile-tab-bar";

export function MobileShell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="mx-auto min-h-dvh max-w-[480px] bg-[#f5f5f7] pb-24 shadow-[0_0_30px_rgba(0,0,0,0.04)]">
      <header className="sticky top-0 z-10 border-b border-black/5 bg-white/85 px-5 py-4 backdrop-blur-xl">
        <p className="text-xs font-medium tracking-[0.2em] text-blue-600">ZHILIANBAO</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">智链宝 V2.0</h1>
      </header>
      <main className="px-5 py-6">{children}</main>
      <MobileTabBar />
    </div>
  );
}
