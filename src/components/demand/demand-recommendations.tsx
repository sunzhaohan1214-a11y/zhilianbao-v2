"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { DemandRecommendationService } from "@/modules/demand";
import { formatShanghaiDateTime } from "@/lib/presentation/date-time";

type RecommendationData = Awaited<ReturnType<DemandRecommendationService["getRecommendations"]>>;

async function command(path: string, body: unknown, headers?: Record<string, string>) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message ?? "操作失败");
  return payload.data;
}

const evidenceLabels: Record<string, string> = {
  PREFERRED_DEMAND_TYPE: "意向需求类型",
  INDUSTRY: "熟悉行业",
  PROFESSIONAL_DIRECTION: "专业方向",
  COORDINATABLE_RESOURCES: "可协调资源",
  CURRENT_OWNER_COUNT: "当前主责需求数",
  RECENT_ACTIVITY: "近期活动",
};

const kindLabels = {
  CURRENT: "在任团员",
  ALUMNI_PLATFORM: "平台内往届",
  ALUMNI_HISTORICAL: "历史往届",
};

const responseLabels: Record<string, string> = { WILLING: "愿意协助", DECLINE: "暂不参与" };
const runStatusLabels: Record<string, string> = { PENDING: "等待运行", RUNNING: "运行中", SUCCEEDED: "已完成", FAILED: "运行失败", SKIPPED: "已跳过" };
const runStageLabels: Record<string, string> = { RULE: "规则推荐", SEMANTIC: "语义增强", FALLBACK: "降级推荐" };

function valueText(value: string | number | string[] | null): string {
  if (value === null) return "未填写";
  return Array.isArray(value) ? value.filter(Boolean).join("、") : String(value);
}

export function DemandRecommendations({ demandId, data }: { demandId: string; data: RecommendationData }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [manualStage, setManualStage] = useState<"CURRENT" | "ALUMNI">("CURRENT");

  async function run(operation: () => Promise<unknown>, success = "操作已完成。") {
    setPending(true);
    setMessage("");
    try {
      await operation();
      setMessage(success);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
    } finally {
      setPending(false);
    }
  }

  function manualAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    return run(() => command(`/api/v2/demands/${demandId}/recommendations/manual-add`, {
      stage: String(form.get("stage")),
      personId: String(form.get("personId")),
      reason: String(form.get("reason")),
      replaceItemId: String(form.get("replaceItemId") ?? "") || null,
    }));
  }

  const allItems = data.currentRuns.flatMap((currentRun) => currentRun.items);
  const willingAlumni = allItems.filter((item) => item.canActivate);
  const replaceableItems = allItems.filter((item) => manualStage === "CURRENT" ? item.candidateKind === "CURRENT" : item.candidateKind !== "CURRENT");
  if (!data.canManage && !data.canRecordHistoricalResponse && data.currentRuns.length === 0) return null;
  return (
    <section className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-indigo-950">智能推荐</h2>
          <p className="mt-1 text-sm text-indigo-800">最多展示 3 人；推荐只提供有来源的参考，不会自动分派负责人。</p>
        </div>
        <p className="rounded-full bg-white px-3 py-1 text-xs text-indigo-700">在任认领截止：{data.claimDeadlineAt ? formatShanghaiDateTime(data.claimDeadlineAt) : "未设置"}</p>
      </div>

      {data.currentRuns.length === 0 ? <p className="mt-4 rounded-xl bg-white p-4 text-sm text-slate-600">当前没有你可见的推荐结果。</p> : data.currentRuns.map((currentRun) => (
        <article key={currentRun.id} className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">{currentRun.stage === "CURRENT" ? "在任推荐" : "往届补充推荐"}</h3>
            <span className="text-xs text-slate-500">{currentRun.status === "FALLBACK_SUCCEEDED" ? "AI 服务暂不可用，当前展示规则推荐" : `${currentRun.items.length} 人`}</span>
          </div>
          {currentRun.items.length === 0 ? <p className="mt-3 text-sm text-slate-500">没有查到具备可验证适配依据的候选人。其他符合资格的在任团员仍可主动认领。</p> : (
            <ol className="mt-3 grid gap-3 lg:grid-cols-3">
              {currentRun.items.map((item) => {
                const evidence = item.evidenceSnapshot.evidence.slice(0, 3);
                const ownerCount = item.evidenceSnapshot.evidence.find(({ key }) => key === "CURRENT_OWNER_COUNT");
                return <li key={item.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between gap-2"><p className="font-semibold">{item.person.name}</p><span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{kindLabels[item.candidateKind]}</span></div>
                  <p className="mt-3 text-sm leading-6 text-slate-700">{item.reason}</p>
                  <dl className="mt-3 space-y-2 text-xs">{evidence.map((entry) => <div key={`${entry.key}-${entry.field}`}><dt className="text-slate-500">{evidenceLabels[entry.key] ?? entry.field}</dt><dd className="mt-0.5 text-slate-800">{valueText(entry.snapshotValue)}</dd></div>)}</dl>
                  {ownerCount && Number(ownerCount.snapshotValue) > 0 && <p className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">当前已有 {valueText(ownerCount.snapshotValue)} 项主责需求，请结合精力安排判断。</p>}
                  {item.responseStatus && <p className="mt-3 text-sm font-medium text-slate-700">已反馈：{responseLabels[item.responseStatus]}</p>}
                  {(item.canDecline || item.canWilling) && <div className="mt-3 flex gap-2">{item.canWilling && <button disabled={pending} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm text-white" onClick={() => void run(() => command(`/api/v2/demands/${demandId}/recommendations/${item.id}/respond`, { response: "WILLING" }))}>愿意协助</button>} {item.canDecline && <button disabled={pending} className="rounded-lg border px-3 py-2 text-sm" onClick={() => void run(() => command(`/api/v2/demands/${demandId}/recommendations/${item.id}/respond`, { response: "DECLINE" }))}>暂不参与</button>}</div>}
                  {item.canRecordOffline && <div className="mt-3 flex flex-wrap gap-2"><button disabled={pending} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm text-white" onClick={() => { const note = window.prompt("填写线下联系说明"); if (note) void run(() => command(`/api/v2/demands/${demandId}/recommendations/${item.id}/respond`, { response: "WILLING", responseNote: note })); }}>登记愿意协助</button><button disabled={pending} className="rounded-lg border px-3 py-2 text-sm" onClick={() => { const note = window.prompt("填写线下联系说明"); if (note) void run(() => command(`/api/v2/demands/${demandId}/recommendations/${item.id}/respond`, { response: "DECLINE", responseNote: note })); }}>登记暂不参与</button></div>}
                </li>;
              })}
            </ol>
          )}
        </article>
      ))}

      {data.canManage && !data.demandAlreadyClaimed && <div className="mt-5 space-y-4 border-t border-indigo-200 pt-4">
        <div className="flex flex-wrap gap-2"><button disabled={pending} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white" onClick={() => void run(() => command(`/api/v2/demands/${demandId}/recommendations/run`, { stage: "CURRENT" }, { "Idempotency-Key": crypto.randomUUID() }), "在任推荐任务已提交，请稍后刷新查看结果。")}>运行在任推荐</button>{data.alumniFallbackEligible && <button disabled={pending} className="rounded-xl bg-purple-600 px-4 py-2 text-sm font-medium text-white" onClick={() => void run(() => command(`/api/v2/demands/${demandId}/recommendations/run`, { stage: "ALUMNI" }, { "Idempotency-Key": crypto.randomUUID() }), "往届推荐任务已提交，请稍后刷新查看结果。")}>运行往届补充推荐</button>}</div>
        <form onSubmit={manualAdd} className="grid gap-2 rounded-xl bg-white p-4 sm:grid-cols-2"><h3 className="font-medium sm:col-span-2">人工添加 / 替换推荐</h3><select name="stage" value={manualStage} onChange={(event) => setManualStage(event.target.value as "CURRENT" | "ALUMNI")} className="rounded-xl border p-3"><option value="CURRENT">在任推荐</option><option value="ALUMNI" disabled={!data.alumniFallbackEligible}>往届补充推荐</option></select><input required name="personId" placeholder="人员 ID" className="rounded-xl border p-3"/><input required maxLength={500} name="reason" placeholder="人工推荐理由" className="rounded-xl border p-3"/><select name="replaceItemId" className="rounded-xl border p-3"><option value="">不替换（当前少于 3 人）</option>{replaceableItems.map((item) => <option key={item.id} value={item.id}>替换 {item.person.name}</option>)}</select><button disabled={pending} className="rounded-xl bg-slate-900 p-3 font-medium text-white sm:col-span-2">保存人工推荐版本</button></form>
        {willingAlumni.length > 0 && <form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void run(() => command(`/api/v2/demands/${demandId}/alumni-help/activate`, { recommendationItemId: String(form.get("recommendationItemId")), townshipHandlerPersonId: String(form.get("townshipHandlerPersonId")), reason: String(form.get("reason")) })); }} className="grid gap-2 rounded-xl bg-white p-4 sm:grid-cols-2"><h3 className="font-medium sm:col-span-2">激活正式往届协助</h3><select required name="recommendationItemId" className="rounded-xl border p-3"><option value="">选择已表达意愿的往届</option>{willingAlumni.map((item) => <option key={item.id} value={item.id}>{item.person.name}</option>)}</select><select required name="townshipHandlerPersonId" className="rounded-xl border p-3"><option value="">选择负责镇区经办人</option>{data.townshipHandlerOptions.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select><input required maxLength={500} name="reason" placeholder="激活原因" className="rounded-xl border p-3 sm:col-span-2"/><button disabled={pending} className="rounded-xl bg-emerald-700 p-3 font-medium text-white sm:col-span-2">确认激活协助关系</button></form>}
        {data.runHistory.length > 0 && <details className="rounded-xl bg-white p-4"><summary className="cursor-pointer font-medium">推荐运行历史</summary><ul className="mt-3 space-y-2 text-xs text-slate-600">{data.runHistory.map((runItem) => <li key={runItem.id}>{runStageLabels[runItem.stage] ?? "推荐计算"} · {runStatusLabels[runItem.status] ?? "状态待确认"} · 候选 {runItem.candidateCount} 人 · {formatShanghaiDateTime(runItem.createdAt)}{runItem.errorCategory ? " · 运行异常" : ""}</li>)}</ul></details>}
      </div>}
      {data.responsibility?.mode === "ALUMNI_TOWNSHIP" && <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">该需求已进入“往届协助 + 镇区经办”责任模式。</p>}
      {message && <p role="status" className="mt-4 rounded-xl bg-white p-3 text-sm text-slate-700">{message}</p>}
    </section>
  );
}
