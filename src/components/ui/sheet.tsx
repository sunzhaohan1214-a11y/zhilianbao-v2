"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "./button";
import { cn } from "./class-names";

export function Sheet({
  children,
  description,
  onClose,
  open,
  side = "bottom",
  title,
}: {
  children: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  open: boolean;
  side?: "bottom" | "right";
  title: ReactNode;
}) {
  const sheetRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    if (open && !sheet.open) sheet.showModal();
    if (!open && sheet.open) sheet.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => { document.documentElement.style.overflow = previous; };
  }, [open]);

  return (
    <dialog
      aria-describedby={description ? descriptionId : undefined}
      aria-labelledby={titleId}
      className={cn(
        "m-0 max-h-dvh border-separator bg-surface p-0 text-foreground shadow-[var(--shadow-raised)]",
        side === "bottom"
          ? "mt-auto w-full max-w-none rounded-t-[var(--radius-xl)] border-x-0 border-b-0"
          : "ml-auto h-dvh w-[min(92vw,440px)] max-w-none rounded-l-[var(--radius-xl)] border-y-0 border-r-0",
      )}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      ref={sheetRef}
    >
      <div className="flex items-start justify-between gap-4 border-b border-separator p-5">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold" id={titleId}>{title}</h2>
          {description && <p className="mt-1 text-sm leading-6 text-muted" id={descriptionId}>{description}</p>}
        </div>
        <Button aria-label="关闭面板" onClick={onClose} size="icon" variant="ghost">
          <svg aria-hidden="true" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </Button>
      </div>
      <div className="max-h-[calc(100dvh-85px)] overflow-y-auto p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{children}</div>
    </dialog>
  );
}
