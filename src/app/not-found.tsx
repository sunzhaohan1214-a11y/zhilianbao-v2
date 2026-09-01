import Link from "next/link";
import { buttonStyles } from "@/components/ui";

export default function NotFound() {
  return <main className="grid min-h-dvh place-items-center bg-background p-6"><section className="w-full max-w-md rounded-3xl border border-separator bg-surface p-8 text-center shadow-sm"><p className="text-sm font-semibold text-brand">页面不存在</p><h1 className="mt-2 text-2xl font-semibold">没有找到你要查看的内容</h1><p className="mt-3 text-sm leading-6 text-muted">内容可能已被移除，或当前链接已经失效。</p><Link className={buttonStyles({ className: "mt-6" })} href="/">返回首页</Link></section></main>;
}
