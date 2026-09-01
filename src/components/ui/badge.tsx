import type { HTMLAttributes } from "react";
import { cn } from "./class-names";

export type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-surface-secondary text-muted ring-separator",
  brand: "bg-brand-soft text-brand ring-[#c9dcff]",
  success: "bg-success-soft text-success ring-[#abefc6]",
  warning: "bg-warning-soft text-warning ring-[#fedf89]",
  danger: "bg-danger-soft text-danger ring-[#fecdca]",
  info: "bg-info-soft text-info ring-[#b2ddff]",
};

export function Badge({ className, tone = "neutral", ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return <span {...props} className={cn("inline-flex min-h-6 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset", tones[tone], className)} />;
}
