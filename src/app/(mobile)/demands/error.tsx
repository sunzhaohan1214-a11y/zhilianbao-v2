"use client";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <section className="rounded-2xl border border-red-200 bg-white p-6 text-center"><h2 className="font-semibold">正式需求加载失败</h2><p className="mt-2 text-sm text-slate-500">请稍后重试；权限不足的需求不会被展示。</p><button onClick={reset} className="mt-4 rounded-xl bg-slate-900 px-4 py-2 text-sm text-white">重新加载</button></section>;
}
