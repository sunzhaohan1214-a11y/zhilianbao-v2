export function BrandLogo({ className = "" }: { className?: string }) {
  return (
    <span
      aria-label="智链宝 Logo"
      className={`inline-grid size-9 shrink-0 place-items-center rounded-[11px] bg-blue-600 text-sm font-semibold text-white ${className}`}
    >
      智
    </span>
  );
}
