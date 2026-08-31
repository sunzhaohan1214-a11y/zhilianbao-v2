import type { ReactNode } from "react";
import { BrandLogo } from "@/components/mobile/brand-logo";

export function AuthCard({ eyebrow, title, description, children }: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="grid min-h-dvh place-items-center bg-grouped px-5 py-10 sm:px-8">
      <section className="grid w-full max-w-[920px] overflow-hidden rounded-[28px] border border-separator bg-surface shadow-[0_24px_80px_rgba(16,24,40,0.12)] md:grid-cols-[1.05fr_1fr]">
        <div className="hidden bg-[linear-gradient(145deg,#1769ff_0%,#0b57e3_52%,#073b9e_100%)] p-12 text-white md:flex md:flex-col md:justify-between">
          <div className="flex items-center gap-3"><span className="grid size-12 place-items-center rounded-2xl bg-white shadow-lg"><BrandLogo /></span><span className="text-xl font-semibold">智链宝</span></div>
          <div>
            <p className="text-sm font-semibold text-white/70">服务宝应人才工作</p>
            <p className="mt-3 max-w-sm text-[30px] font-semibold leading-[1.3] tracking-tight">让人才、企业与服务资源高效连接</p>
          </div>
          <p className="text-xs text-white/60">数据以系统正式记录为准</p>
        </div>
        <div className="p-7 sm:p-10 md:p-12">
          <div className="mb-8 flex items-center gap-3 md:hidden"><BrandLogo /><span className="font-semibold">智链宝</span></div>
          <p className="text-xs font-semibold tracking-[0.18em] text-brand">{eyebrow}</p>
          <h1 className="mt-3 text-[30px] font-semibold tracking-[-0.025em] text-foreground">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
          <div className="mt-8">{children}</div>
        </div>
      </section>
    </main>
  );
}
