import type {
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "./class-names";

const controlStyles = "min-h-11 w-full rounded-[var(--radius-m)] border border-separator bg-surface px-3.5 py-2.5 text-[15px] text-foreground shadow-[var(--shadow-subtle)] outline-none transition placeholder:text-tertiary hover:border-[#cfd4dc] focus:border-brand disabled:cursor-not-allowed disabled:bg-surface-secondary disabled:text-tertiary aria-[invalid=true]:border-danger aria-[invalid=true]:focus:border-danger";

export function Field({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid gap-2", className)}>{children}</div>;
}

export function FieldLabel({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label {...props} className={cn("text-sm font-semibold text-foreground", className)} />;
}

export function FieldHint({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-xs leading-5 text-tertiary", className)}>{children}</p>;
}

export function FieldError({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return <p className={cn("text-xs leading-5 text-danger", className)} id={id} role="alert">{children}</p>;
}

export function Input({ className, invalid = false, ...props }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input {...props} aria-invalid={invalid || props["aria-invalid"] || undefined} className={cn(controlStyles, className)} />;
}

export function Select({ children, className, invalid = false, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode; invalid?: boolean }) {
  return (
    <select {...props} aria-invalid={invalid || props["aria-invalid"] || undefined} className={cn(controlStyles, "appearance-none bg-[linear-gradient(45deg,transparent_50%,var(--text-tertiary)_50%),linear-gradient(135deg,var(--text-tertiary)_50%,transparent_50%)] bg-[length:5px_5px,5px_5px] bg-[position:calc(100%-16px)_50%,calc(100%-11px)_50%] bg-no-repeat pr-9", className)}>
      {children}
    </select>
  );
}

export function Textarea({ className, invalid = false, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return <textarea {...props} aria-invalid={invalid || props["aria-invalid"] || undefined} className={cn(controlStyles, "min-h-28 resize-y leading-6", className)} />;
}
