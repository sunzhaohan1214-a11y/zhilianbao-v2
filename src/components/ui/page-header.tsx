import type { ReactNode } from "react";
import { cn } from "./class-names";

export function PageHeader({
  actions,
  className,
  description,
  eyebrow,
  title,
}: {
  actions?: ReactNode;
  className?: string;
  description?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
}) {
  return (
    <header className={cn("flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow && <p className="text-sm font-semibold text-brand">{eyebrow}</p>}
        <h1 className={cn("text-[26px] font-semibold leading-tight tracking-[-0.02em] text-foreground", Boolean(eyebrow) && "mt-1")}>
          {title}
        </h1>
        {description && <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div>}
    </header>
  );
}

export function SectionHeader({
  action,
  className,
  description,
  id,
  title,
}: {
  action?: ReactNode;
  className?: string;
  description?: ReactNode;
  id?: string;
  title: ReactNode;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <h2 className="text-[17px] font-semibold tracking-tight text-foreground" id={id}>
          {title}
        </h2>
        {description && <p className="mt-1 text-sm leading-6 text-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
