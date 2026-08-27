import Link from "next/link";

export default function ResourcesPage() {
  const resources = [
    ["企业", "/resources/enterprises", "企业名录、联系人和纠错申请"],
    ["团员", "/resources/members", "在任与往届团员、专业方向和批次履历"],
    ["政策", "/resources/policies", "政策原文、智能解读与效力状态"],
    ["人才库", "/resources/talents", "海内外人才名录、推荐申请和镇街对接"],
    ["通讯录", "/resources/contacts", "按组织查看当前在岗人员与联系电话"],
  ] as const;
  return <section>
    <h2 className="text-2xl font-semibold text-slate-950">资源</h2>
    <p className="mt-2 text-sm text-slate-500">按业务优先级浏览全县资源。</p>
    <div className="mt-5 space-y-3">{resources.map(([label, href, description], index) =>
      <Link key={label} href={href} className="block rounded-2xl border border-blue-100 bg-white p-4 shadow-sm hover:border-blue-300">
        <div className="flex items-center justify-between"><span className="font-semibold text-slate-950">{index + 1}. {label}</span><span className="text-blue-600">›</span></div>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </Link>)}</div>
  </section>;
}
