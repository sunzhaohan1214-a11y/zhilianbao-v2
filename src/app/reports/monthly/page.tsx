import Link from "next/link";
import { MonthlyReportConsole } from "@/components/reporting/monthly-report-console";
import { reportingPageContext } from "@/lib/reporting/page-context";
import { canDownloadMonthlyReport, canViewMonthlyReport } from "@/modules/reporting/reporting-scope";

export const dynamic = "force-dynamic";

export default async function MonthlyReportPage() {
  const { actor, service } = await reportingPageContext();
  if (!canViewMonthlyReport(actor)) return <main className="grid min-h-dvh place-items-center bg-slate-50 p-6"><section className="max-w-md rounded-3xl border bg-white p-8 text-center"><p className="text-sm font-medium text-red-600">无权访问</p><h1 className="mt-2 text-2xl font-semibold">当前账号不能查看月度工作台账</h1><Link href="/me" className="mt-5 inline-block text-blue-700">返回我的</Link></section></main>;
  const options = await service.options(actor);
  return <main className="min-h-dvh bg-slate-50 px-4 py-8 sm:px-8"><div className="mx-auto max-w-7xl"><div className="mb-7 flex items-end justify-between gap-4"><div><p className="text-sm font-medium text-blue-600">C-M3-004 REPORTING</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">月度工作台账</h1><p className="mt-2 text-sm text-slate-600">结构化正式数据 · Asia/Shanghai 自然月 · 历史时点可审计</p></div><Link href={actor.capabilities.has("admin.shell.access") ? "/admin" : "/me"} className="text-sm text-blue-700">返回</Link></div><MonthlyReportConsole areas={options.areas} batches={options.batches.map((item) => ({ id: item.id, name: item.name }))} countyWide={options.scope.countyWide} canDownload={canDownloadMonthlyReport(actor)} /></div></main>;
}
