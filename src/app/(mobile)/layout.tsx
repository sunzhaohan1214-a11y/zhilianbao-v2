import type { ReactNode } from "react";
import { MobileShell } from "@/components/mobile/mobile-shell";

export default function MobileLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <MobileShell>{children}</MobileShell>;
}
