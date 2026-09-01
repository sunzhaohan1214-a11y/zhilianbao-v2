import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./class-names";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

const variantStyles: Record<ButtonVariant, string> = {
  primary: "bg-brand text-white shadow-[var(--shadow-subtle)] hover:bg-[var(--brand-hover)]",
  secondary: "border border-separator bg-surface text-foreground shadow-[var(--shadow-subtle)] hover:bg-surface-secondary",
  ghost: "bg-transparent text-muted hover:bg-surface-secondary hover:text-foreground",
  danger: "bg-danger text-white shadow-[var(--shadow-subtle)] hover:bg-[#b42318]",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "min-h-11 rounded-[var(--radius-m)] px-3.5 text-sm",
  md: "min-h-11 rounded-[var(--radius-m)] px-4 text-sm",
  lg: "min-h-12 rounded-[var(--radius-l)] px-5 text-base",
  icon: "size-11 rounded-full p-0",
};

export function buttonStyles({
  variant = "primary",
  size = "md",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}) {
  return cn(
    "inline-flex shrink-0 items-center justify-center gap-2 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    variantStyles[variant],
    sizeStyles[size],
    className,
  );
}

export function Button({
  children,
  className,
  disabled,
  isLoading = false,
  size = "md",
  type = "button",
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  isLoading?: boolean;
  size?: ButtonSize;
  variant?: ButtonVariant;
}) {
  return (
    <button
      {...props}
      aria-busy={isLoading || undefined}
      className={buttonStyles({ variant, size, className })}
      disabled={disabled || isLoading}
      type={type}
    >
      {isLoading && (
        <svg aria-hidden="true" className="size-4 animate-spin" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" fill="none" r="9" stroke="currentColor" strokeWidth="3" />
          <path className="opacity-90" d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="3" />
        </svg>
      )}
      {children}
    </button>
  );
}
