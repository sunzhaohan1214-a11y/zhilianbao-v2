import Link from "next/link";

export default function NotFound() {
  return <section className="rounded-2xl border bg-white p-8 text-center"><h2 className="text-xl font-semibold">未找到正式需求</h2><p className="mt-2 text-slate-500">需求不存在，或当前账号无权访问。</p><Link href="/admin/demands" className="mt-4 inline-block text-blue-700">返回正式需求列表</Link></section>;
}
