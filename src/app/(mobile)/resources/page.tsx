import Link from "next/link";

export default function ResourcesPage() {
  const resources = [
    ["企业", "/resources/enterprises", "企业名录、联系人和纠错申请"],
    ["团员", "#", "团员资源（后续里程碑）"],
    ["政策", "/resources/policies", "政策原文、智能解读与效力状态"],
    ["人才库", "#", "人才资源（后续里程碑）"],
    ["通讯录", "#", "组织通讯录（后续里程碑）"],
  ] as const;
  return <section>
    <h2 className="text-2xl font-semibold text-slate-950">资源</h2>
    <p className="mt-2 text-sm text-slate-500">按业务优先级浏览全县资源。</p>
    <div className="mt-5 space-y-3">{resources.map(([label, href, description], index) =>
      <Link key={label} href={href} aria-disabled={href === "#"} className={`block rounded-2xl border bg-white p-4 shadow-sm ${href === "#" ? "pointer-events-none border-slate-100 opacity-60" : "border-blue-100 hover:border-blue-300"}`}>
        <div className="flex items-center justify-between"><span className="font-semibold text-slate-950">{index + 1}. {label}</span><span className="text-blue-600">›</span></div>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </Link>)}</div>
  </section>;
}
