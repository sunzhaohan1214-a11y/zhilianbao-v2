export function BrandLogo({ className = "" }: { className?: string }) {
  return (
    <span
      aria-label="智链宝 Logo"
      className={`relative inline-grid size-9 shrink-0 place-items-center rounded-[11px] bg-brand text-sm font-semibold text-white shadow-sm ${className}`}
    >
      智
      <span aria-hidden="true" className="absolute -bottom-0.5 -right-0.5 h-2.5 w-3.5 rotate-[-18deg] rounded-[100%_0_100%_0] border-2 border-white bg-lotus" />
    </span>
  );
}
