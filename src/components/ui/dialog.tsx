"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "./button";
import { cn } from "./class-names";

export function Dialog({
  children,
  className,
  description,
  onClose,
  open,
  title,
}: {
  children: ReactNode;
  className?: string;
  description?: ReactNode;
  onClose: () => void;
  open: boolean;
  title: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
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
      className={cn("m-auto w-[min(92vw,520px)] rounded-[var(--radius-xl)] border border-separator bg-surface p-0 text-foreground shadow-[var(--shadow-raised)]", className)}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      ref={dialogRef}
    >
      <div className="flex items-start justify-between gap-4 border-b border-separator p-5">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight" id={titleId}>{title}</h2>
          {description && <p className="mt-1.5 text-sm leading-6 text-muted" id={descriptionId}>{description}</p>}
        </div>
        <Button aria-label="关闭弹窗" onClick={onClose} size="icon" variant="ghost">
          <svg aria-hidden="true" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </Button>
      </div>
      <div className="max-h-[min(70vh,720px)] overflow-y-auto p-5">{children}</div>
    </dialog>
  );
}

export function DialogActions({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end", className)}>{children}</div>;
}
