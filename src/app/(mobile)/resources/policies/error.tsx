"use client";
export default function ErrorPage({ reset }: { reset: () => void }) { return <section className="rounded-2xl bg-white p-6"><h1 className="font-semibold">政策暂时无法加载</h1><button onClick={reset} className="mt-4 rounded-xl bg-blue-600 px-4 py-2 text-white">重试</button></section>; }
