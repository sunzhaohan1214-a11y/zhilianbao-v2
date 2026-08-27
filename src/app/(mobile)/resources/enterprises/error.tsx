"use client";
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) { return <section className="rounded-2xl bg-white p-6 text-center"><h2 className="font-semibold">企业信息加载失败</h2><p className="mt-2 text-sm text-slate-500">请检查网络或稍后重试。</p><button onClick={reset} className="mt-4 rounded-xl bg-blue-600 px-4 py-2 text-white">重试</button></section>; }
