import type { ReactNode } from "react";

export function AuthCard({ eyebrow, title, description, children }: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="grid min-h-dvh place-items-center bg-[#f5f5f7] px-5 py-10">
      <section className="w-full max-w-[420px] rounded-[28px] border border-black/5 bg-white p-7 shadow-[0_20px_70px_rgba(0,0,0,0.08)]">
        <p className="text-xs font-semibold tracking-[0.18em] text-blue-600">{eyebrow}</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-neutral-500">{description}</p>
        <div className="mt-7">{children}</div>
      </section>
    </main>
  );
}
