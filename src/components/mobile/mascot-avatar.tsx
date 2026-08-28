export function MascotAvatar({ className = "" }: { className?: string }) {
  return (
    <span
      aria-label="荷宝"
      className={`inline-grid size-11 shrink-0 place-items-center rounded-full border border-blue-100 bg-blue-50 text-base font-semibold text-blue-700 ${className}`}
    >
      荷
    </span>
  );
}
