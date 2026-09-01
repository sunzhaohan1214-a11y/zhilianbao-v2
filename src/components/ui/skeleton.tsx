import type { HTMLAttributes } from "react";
import { cn } from "./class-names";

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} aria-hidden="true" className={cn("animate-pulse rounded-[var(--radius-s)] bg-[#e4e9f0]", className)} />;
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div aria-label="内容加载中" className={cn("rounded-[var(--radius-l)] border border-separator bg-surface p-5", className)} role="status">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-4 h-6 w-3/4" />
      <Skeleton className="mt-3 h-4 w-full" />
      <Skeleton className="mt-2 h-4 w-2/3" />
    </div>
  );
}
