import type { ReactNode } from "react";
import { MobileTabBar } from "./mobile-tab-bar";

export function MobileShell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="mx-auto min-h-dvh max-w-[480px] bg-[#f5f5f7] pb-24 shadow-[0_0_30px_rgba(0,0,0,0.04)]">
      <main className="px-5 py-6">{children}</main>
      <MobileTabBar />
    </div>
  );
}
