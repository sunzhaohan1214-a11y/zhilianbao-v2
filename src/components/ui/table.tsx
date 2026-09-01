import type { HTMLAttributes, TableHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "./class-names";

export function TableFrame({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn("w-full overflow-x-auto rounded-[var(--radius-l)] border border-separator bg-surface", className)} />;
}

export function Table({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return <table {...props} className={cn("w-full min-w-[640px] border-collapse text-left text-sm", className)} />;
}

export function TableHead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead {...props} className={cn("bg-surface-secondary text-xs font-semibold text-muted", className)} />;
}

export function TableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} className={cn("divide-y divide-separator", className)} />;
}

export function TableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr {...props} className={cn("transition-colors hover:bg-surface-secondary", className)} />;
}

export function TableHeaderCell({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th {...props} className={cn("whitespace-nowrap px-4 py-3", className)} scope={props.scope ?? "col"} />;
}

export function TableCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td {...props} className={cn("px-4 py-3.5 align-top text-foreground", className)} />;
}
