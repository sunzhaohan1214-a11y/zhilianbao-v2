import type { ReactNode } from "react";
import { BrandLogo } from "@/components/mobile/brand-logo";

export function AuthCard({ eyebrow, title, description, children }: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="baoying-atmosphere grid min-h-dvh place-items-center px-5 py-10 sm:px-8">
      <section className="grid w-full max-w-[920px] overflow-hidden rounded-[28px] border border-separator bg-surface shadow-[0_24px_80px_rgba(16,24,40,0.12)] md:grid-cols-[1.05fr_1fr]">
        <div className="relative hidden overflow-hidden bg-[linear-gradient(145deg,#155bba_0%,#124d91_48%,#173f67_100%)] p-12 text-white md:flex md:flex-col md:justify-between">
          <svg aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-56 w-full text-white/15" viewBox="0 0 520 224" fill="none" preserveAspectRatio="none">
            <path d="M-20 145C68 112 128 178 216 145S364 112 540 150" stroke="currentColor" strokeWidth="2" />
            <path d="M-20 174C72 142 137 202 229 169S386 141 540 178" stroke="currentColor" strokeWidth="2" />
            <path d="M393 62c-38-1-67 18-75 54 37 6 68-10 75-54Z" fill="rgba(155,190,164,0.34)" />
            <path d="M393 62c20 24 25 52 13 84" stroke="rgba(199,220,204,0.42)" strokeWidth="2" />
          </svg>
          <div className="flex items-center gap-3"><span className="grid size-12 place-items-center rounded-2xl bg-white shadow-lg"><BrandLogo /></span><span className="text-xl font-semibold">智链宝</span></div>
          <div className="relative">
            <p className="text-sm font-semibold text-white/72">扬州市电力装备产业科技镇长团</p>
            <p className="mt-3 max-w-sm text-[30px] font-semibold leading-[1.3] tracking-tight">内部产业协同工作平台</p>
            <p className="mt-4 max-w-sm text-sm leading-6 text-white/72">围绕企业需求、人才资源与产业服务，形成可信、可追踪的协同闭环。</p>
          </div>
          <p className="relative text-xs text-white/60">数据以系统正式记录为准</p>
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
