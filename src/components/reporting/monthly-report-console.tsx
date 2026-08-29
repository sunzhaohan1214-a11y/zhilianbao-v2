"use client";

import { useEffect, useMemo, useState } from "react";

type Option = { id: string; name: string };
type Preview = {
  period: { month: string; asOf: string; current: boolean };
  overview: {
    demand: { added: number; completed: number; stock: Record<string, number>; stale: number; outcomeDue: number };
    resources: { enterpriseTotal: number; enterpriseNormal: number; memberCount: number; arrivalVisits: number; presentPeople: number };
    trips: { tripCount: number; participantVisits: number; distinctParticipants: number; distinctEnterprises: number; leadCount: number };
    talent: { added: number; completedRounds: number; inProgressRounds: number; domestic: number; overseas: number };
    outcome: { contractAmount: string; investmentAmount: string; policyFund: string; costReduction: string; talentIntroduced: number; patent: number };
  };
  rowCounts: { demands: number; trips: number; talents: number; outcomes: number };
  warnings: Array<{ code: string; count: number; message: string }>;
};
type Task = { id: string; status: string; outputAttachmentId: string | null; errorCode: string | null };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
  const body = await response.json() as { ok: boolean; data?: T; error?: { message: string } };
  if (!response.ok || !body.ok || !body.data) throw new Error(body.error?.message ?? "请求失败");
  return body.data;
}

function currentShanghaiMonth() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const part = (type: "year" | "month") => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}`;
}

export function MonthlyReportConsole({ areas, batches, countyWide, canDownload }: { areas: Option[]; batches: Option[]; countyWide: boolean; canDownload: boolean }) {
  const [month, setMonth] = useState(currentShanghaiMonth());
  const [batchId, setBatchId] = useState(""); const [areaId, setAreaId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null); const [task, setTask] = useState<Task | null>(null);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const query = useMemo(() => new URLSearchParams({ month, ...(batchId ? { batchId } : {}), ...(areaId ? { areaId } : {}) }), [month, batchId, areaId]);
  async function loadPreview() { setBusy(true); setMessage("正在按历史时点计算…"); try { setPreview(await request<Preview>(`/api/v2/reports/monthly?${query}`)); setMessage(""); } catch (error) { setMessage(error instanceof Error ? error.message : "预览失败"); } finally { setBusy(false); } }
  async function createExport() { setBusy(true); setMessage("正在创建私有导出任务…"); try { const created = await request<Task>("/api/v2/reports/monthly/exports", { method: "POST", headers: { "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ month, ...(batchId ? { batchId } : {}), ...(areaId ? { areaId } : {}) }) }); setTask(created); setMessage("任务已进入安全队列。"); } catch (error) { setMessage(error instanceof Error ? error.message : "创建失败"); } finally { setBusy(false); } }
  async function download(attachmentId: string) { try { const result = await request<{ url: string }>(`/api/v2/attachments/${attachmentId}/access?action=download`); window.location.assign(result.url); } catch (error) { setMessage(error instanceof Error ? error.message : "下载失败"); } }
  useEffect(() => { if (!task || !["WAITING", "RUNNING"].includes(task.status)) return; const timer = window.setInterval(async () => { try { const next = await request<Task>(`/api/v2/reports/monthly/exports/${task.id}`); setTask(next); if (next.status === "SUCCEEDED") setMessage("五张工作表已生成，可安全下载。"); if (next.status === "FAILED") setMessage(`生成失败：${next.errorCode ?? "REPORT_EXPORT_FAILED"}`); } catch { /* keep the last visible state and retry */ } }, 1500); return () => window.clearInterval(timer); }, [task]);
  const cards = preview ? [
    ["本月新增需求", preview.overview.demand.added], ["本月办结需求", preview.overview.demand.completed], ["月末对接中", preview.overview.demand.stock.IN_PROGRESS ?? 0], ["久未更新", preview.overview.demand.stale],
    ["企业 / 有效", `${preview.overview.resources.enterpriseTotal} / ${preview.overview.resources.enterpriseNormal}`], ["团员人数", preview.overview.resources.memberCount], ["本月到宝人次", preview.overview.resources.arrivalVisits], ["月末在宝人数", preview.overview.resources.presentPeople],
    ["行程次数", preview.overview.trips.tripCount], ["去重走访企业", preview.overview.trips.distinctEnterprises], ["本月新增人才", preview.overview.talent.added], ["合同金额新增", `¥${preview.overview.outcome.contractAmount}`],
  ] : [];
  return <div className="space-y-6">
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="grid gap-4 md:grid-cols-3">
        <label className="text-sm font-medium text-slate-700">月份<input aria-label="月份" type="month" value={month} max={currentShanghaiMonth()} onChange={(event) => setMonth(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2" /></label>
        <label className="text-sm font-medium text-slate-700">批次（可选）<select aria-label="批次" value={batchId} onChange={(event) => setBatchId(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2"><option value="">全部 / 时点批次</option>{batches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="text-sm font-medium text-slate-700">镇区 / 范围<select aria-label="镇区范围" value={areaId} onChange={(event) => setAreaId(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2">{countyWide && <option value="">全县</option>}{!countyWide && areas.length > 1 && <option value="">全部授权镇区</option>}{areas.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      </div>
      <div className="mt-5 flex flex-wrap gap-3"><button type="button" onClick={loadPreview} disabled={busy || !month} className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-40">结构化预览</button>{canDownload && <button type="button" onClick={createExport} disabled={busy || !preview} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-40">生成五表 Excel</button>}{task?.status === "SUCCEEDED" && task.outputAttachmentId && <button type="button" onClick={() => download(task.outputAttachmentId!)} className="rounded-xl border border-blue-600 px-5 py-2.5 text-sm font-medium text-blue-700">安全下载</button>}</div>
      {message && <p role="status" className="mt-3 text-sm text-slate-600">{message}</p>}
    </section>
    {!preview && <section className="rounded-3xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-500">选择月份后先生成结构化预览。完整明细请在电脑端查看 Excel；手机端也可发起导出。</section>}
    {preview && <>
      <p className="text-sm text-slate-600">{preview.period.current ? `截至当前（${preview.period.asOf}）` : `月末时点（${preview.period.asOf}）`} · 不含报销、办事求助、排名或 AI 叙述。</p>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{cards.map(([label, value]) => <article key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p></article>)}</section>
      <section className="rounded-3xl border border-slate-200 bg-white p-5"><h2 className="text-lg font-semibold">固定五张工作表</h2><div className="mt-4 grid gap-3 md:grid-cols-5">{[["月度概览", 1], ["需求进展", preview.rowCounts.demands], ["走访与行程", preview.rowCounts.trips], ["人才对接", preview.rowCounts.talents], ["成效跟踪", preview.rowCounts.outcomes]].map(([name, count]) => <div key={String(name)} className="rounded-xl bg-slate-50 p-3"><p className="font-medium">{name}</p><p className="mt-1 text-sm text-slate-500">{count} 行</p></div>)}</div></section>
      <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5"><h2 className="font-semibold text-amber-950">数据质量说明</h2>{preview.warnings.length === 0 ? <p className="mt-2 text-sm text-amber-900">本次预览未发现需要说明的历史归属问题。</p> : <ul className="mt-3 space-y-2 text-sm text-amber-950">{preview.warnings.map((warning) => <li key={warning.code}><code>{warning.code}</code> × {warning.count}：{warning.message}</li>)}</ul>}</section>
    </>}
  </div>;
}
