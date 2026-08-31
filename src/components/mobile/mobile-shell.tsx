import type { ReactNode } from "react";
import { MobileTabBar } from "./mobile-tab-bar";

export function MobileShell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="mx-auto min-h-dvh max-w-[480px] bg-background pb-[calc(5.5rem+env(safe-area-inset-bottom))] shadow-[0_0_40px_rgba(16,24,40,0.06)]">
      <main className="px-5 py-6 sm:px-6">{children}</main>
      <MobileTabBar />
    </div>
  );
}
