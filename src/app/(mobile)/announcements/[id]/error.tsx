"use client";
import Link from "next/link";
export default function AnnouncementErrorPage(){return <section className="rounded-2xl bg-white p-8 text-center shadow-sm"><p className="text-sm text-amber-700">公告当前不可访问</p><h1 className="mt-2 text-xl font-semibold">公告可能已撤回，或你已不在接收范围内</h1><p className="mt-3 text-sm text-slate-500">历史消息仍会保留，但不会继续展示已失权内容。</p><Link href="/announcements" className="mt-5 inline-block rounded-xl bg-blue-600 px-4 py-2 text-sm text-white">返回公告列表</Link></section>}
