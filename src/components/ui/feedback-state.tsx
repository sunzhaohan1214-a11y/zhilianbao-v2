import type { ReactNode } from "react";
import { cn } from "./class-names";

function StateIcon({ tone }: { tone: "neutral" | "danger" }) {
  return tone === "danger" ? (
    <svg aria-hidden="true" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M12 8v5m0 3.5v.5" /><path d="M10.3 4.5 3.7 16a2 2 0 0 0 1.7 3h13.2a2 2 0 0 0 1.7-3L13.7 4.5a2 2 0 0 0-3.4 0Z" /></svg>
  ) : (
    <svg aria-hidden="true" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Z" /><path d="m4.5 7.8 7.5 4.3 7.5-4.3M12 12v8.5" /></svg>
  );
}

function FeedbackState({
  action,
  className,
  description,
  role = "status",
  title,
  tone,
}: {
  action?: ReactNode;
  className?: string;
  description: ReactNode;
  role?: "alert" | "status";
  title: ReactNode;
  tone: "neutral" | "danger";
}) {
  return (
    <section className={cn("grid justify-items-center rounded-[var(--radius-l)] border border-dashed border-separator bg-surface p-8 text-center", className)} role={role}>
      <span className={cn("grid size-12 place-items-center rounded-full", tone === "danger" ? "bg-danger-soft text-danger" : "bg-surface-secondary text-muted")}><StateIcon tone={tone} /></span>
      <h2 className="mt-4 text-[17px] font-semibold text-foreground">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </section>
  );
}

export function EmptyState(props: Omit<Parameters<typeof FeedbackState>[0], "tone" | "role">) {
  return <FeedbackState {...props} tone="neutral" />;
}

export function ErrorState(props: Omit<Parameters<typeof FeedbackState>[0], "tone" | "role">) {
  return <FeedbackState {...props} role="alert" tone="danger" />;
}
