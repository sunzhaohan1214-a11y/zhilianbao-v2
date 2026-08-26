import type { ReactNode } from "react";
import { MobileShell } from "@/components/mobile/mobile-shell";
import { requireBusinessPageSession } from "@/lib/auth/guards";

export default async function MobileLayout({ children }: Readonly<{ children: ReactNode }>) {
  await requireBusinessPageSession();
  return <MobileShell>{children}</MobileShell>;
}
