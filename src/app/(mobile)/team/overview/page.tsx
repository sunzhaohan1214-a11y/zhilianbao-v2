import Link from "next/link";
import { notFound } from "next/navigation";
import { homePageContext } from "@/lib/home/page-context";

export default async function TeamOverviewPage() {
  const now = new Date();
  const { actor, service } = await homePageContext(now);
  if (!actor.capabilities.has("team.overview.view") || (!actor.effectiveRoles.includes("GROUP_LEADER") && !actor.effectiveRoles.includes("MINISTER"))) notFound();
  const overview = await service.teamOverview({ actor, now });
  const items = [
    { label: "待对接", value: overview.pendingClaim, href: "/demands?status=PENDING_CLAIM", note: "尚无正式主责" },
    { label: "对接中", value: overview.inProgress, href: "/demands?status=IN_PROGRESS", note: "已进入正式对接" },
    { label: "久未更新", value: overview.stale, href: "/demands?status=IN_PROGRESS", note: "对接中超过 30 个上海自然日的子集" },
    { label: "待办结审核", value: overview.pendingCloseReview, href: "/demands?status=PENDING_CLOSE_REVIEW", note: "等待管理员核实" },
  ];
  return <section><Link href="/" className="text-sm text-blue-700">‹ 返回首页</Link><div className="mt-5"><p className="text-sm text-blue-600">{overview.roleLabels.join(" · ")}</p><h1 className="mt-1 text-2xl font-semibold">全团概览</h1><p className="mt-2 text-sm leading-6 text-neutral-500">实时读取需求正式状态；“久未更新”是对接中子集，不重复计入主状态存量。</p></div><div className="mt-6 space-y-3">{items.map((item) => <Link key={item.label} href={item.href} className="flex items-center justify-between gap-4 rounded-2xl border border-black/5 bg-white p-5"><div><h2 className="font-medium">{item.label}</h2><p className="mt-1 text-xs text-neutral-500">{item.note}</p></div><div className="flex items-center gap-3"><strong className="text-2xl font-semibold">{item.value}</strong><span aria-hidden="true" className="text-neutral-300">›</span></div></Link>)}</div><p className="mt-6 text-xs leading-5 text-neutral-400">本页仅提供第一阶段轻量全团概览，不含督办、评分、排名、趋势或月报。</p></section>;
}
