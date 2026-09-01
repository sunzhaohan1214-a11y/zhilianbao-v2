export function MascotAvatar({ className = "" }: { className?: string }) {
  return (
    <span
      aria-label="荷宝"
      className={`inline-grid size-11 shrink-0 place-items-center rounded-full border border-lotus/20 bg-lotus-soft text-base font-semibold text-lotus ${className}`}
    >
      荷
    </span>
  );
}
