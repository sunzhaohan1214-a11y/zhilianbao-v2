"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import type { DemandOutcomeService } from "@/modules/demand";
import { AttachmentOpenButton } from "@/components/policy/attachment-open-button";
import { uploadFormalAttachments } from "./formal-attachment-upload";

type Data = Awaited<ReturnType<DemandOutcomeService["overview"]>>;
type Round = Data["rounds"][number];

async function post(path: string, body: unknown, idempotencyKey?: string) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message ?? "操作失败");
  return payload.data;
}

function value(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

function count(form: FormData, name: string): number {
  return Number(value(form, name) || "0");
}

function moneyDisplay(value: string): string {
  const [integer, fraction = "00"] = value.split(".");
  return `¥${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction.padEnd(2, "0")}`;
}

const planStatus: Record<string, string> = {
  NOT_TRACKED: "不跟踪",
  PENDING: "待首次跟踪",
  IN_PROGRESS: "跟踪中",
  ENDED: "已结束",
};

const reviewStatus: Record<string, string> = {
  DRAFT: "草稿",
  PENDING_REVIEW: "待审核",
  RETURNED: "已退回",
  APPROVED: "已通过",
};

function roundBody(form: FormData) {
  return {
    trackingDate: value(form, "trackingDate"),
    contractAmountIncrement: value(form, "contractAmountIncrement") || "0",
    investmentAmountIncrement: value(form, "investmentAmountIncrement") || "0",
    policyFundIncrement: value(form, "policyFundIncrement") || "0",
    costReductionIncrement: value(form, "costReductionIncrement") || "0",
    talentIntroducedIncrement: count(form, "talentIntroducedIncrement"),
    patentIncrement: count(form, "patentIncrement"),
    qualitativeResult: value(form, "qualitativeResult") || undefined,
    enterpriseFeedback: value(form, "enterpriseFeedback") || undefined,
    nextTrackingDate: value(form, "nextTrackingDate") || null,
    endTracking: form.get("endTracking") === "on",
  };
}

function RoundFields({ round }: { round?: Round }) {
  const field = "mt-1 w-full rounded-xl border border-slate-300 bg-white p-3";
  return <div className="grid gap-4 sm:grid-cols-2">
    <label className="text-sm font-medium">实际跟踪日期<input required name="trackingDate" type="date" defaultValue={round?.trackingDate} className={field} /></label>
    <label className="text-sm font-medium">合同金额（本轮新增）<input name="contractAmountIncrement" inputMode="decimal" defaultValue={round?.contractAmountIncrement ?? "0.00"} className={field} /></label>
    <label className="text-sm font-medium">投资额（本轮新增）<input name="investmentAmountIncrement" inputMode="decimal" defaultValue={round?.investmentAmountIncrement ?? "0.00"} className={field} /></label>
    <label className="text-sm font-medium">政策资金（本轮新增）<input name="policyFundIncrement" inputMode="decimal" defaultValue={round?.policyFundIncrement ?? "0.00"} className={field} /></label>
    <label className="text-sm font-medium">降本金额（本轮新增）<input name="costReductionIncrement" inputMode="decimal" defaultValue={round?.costReductionIncrement ?? "0.00"} className={field} /></label>
    <label className="text-sm font-medium">引进人才（本轮新增）<input name="talentIntroducedIncrement" type="number" min="0" step="1" defaultValue={round?.talentIntroducedIncrement ?? 0} className={field} /></label>
    <label className="text-sm font-medium">专利（本轮新增）<input name="patentIncrement" type="number" min="0" step="1" defaultValue={round?.patentIncrement ?? 0} className={field} /></label>
    <label className="text-sm font-medium sm:col-span-2">定性成效<textarea name="qualitativeResult" maxLength={5000} rows={3} defaultValue={round?.qualitativeResult ?? ""} className={field} /></label>
    <label className="text-sm font-medium sm:col-span-2">企业反馈<textarea name="enterpriseFeedback" maxLength={5000} rows={3} defaultValue={round?.enterpriseFeedback ?? ""} className={field} /></label>
    <label className="text-sm font-medium">下次跟踪日期<input name="nextTrackingDate" type="date" defaultValue={round?.nextTrackingDate ?? ""} className={field} /></label>
    <label className="flex items-center gap-2 self-end rounded-xl bg-slate-50 p-3 text-sm font-medium"><input name="endTracking" type="checkbox" defaultChecked={round?.endTracking} /> 本轮通过后结束跟踪</label>
    <label className="text-sm font-medium sm:col-span-2">新增佐证附件（可选）<input name="attachments" type="file" multiple className={field} /></label>
  </div>;
}

export function DemandOutcomePanel({ demandId, data }: { demandId: string; data: Data }) {
  const router = useRouter();
  const keys = useRef<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const key = (action: string) => keys.current[action] ??= crypto.randomUUID();

  async function run(action: string, operation: () => Promise<unknown>) {
    setPending(true);
    setMessage("");
    try {
      await operation();
      delete keys.current[action];
      setMessage("操作已完成。");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
    } finally { setPending(false); }
  }

  async function attachmentIds(form: FormData) {
    return uploadFormalAttachments(form.getAll("attachments").filter((item): item is File => item instanceof File && item.size > 0));
  }

  function plan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const trackingMode = value(form, "trackingMode");
    const body = trackingMode === "TRACKING"
      ? { trackingMode, firstTrackingDate: value(form, "firstTrackingDate") }
      : { trackingMode: "NONE" };
    void run("plan", () => post(`/api/v2/demands/${demandId}/outcome-plan`, body, key("plan")));
  }

  function createRound(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run("create-round", async () => post(`/api/v2/demands/${demandId}/outcomes`, { ...roundBody(form), attachmentIds: await attachmentIds(form) }, key("create-round")));
  }

  function updateRound(event: FormEvent<HTMLFormElement>, round: Round) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(`update:${round.id}`, async () => post(`/api/v2/demand-outcomes/${round.id}/update`, { ...roundBody(form), expectedVersion: round.editVersion, attachmentIds: await attachmentIds(form) }));
  }

  const card = "space-y-4 rounded-2xl border border-slate-200 bg-white p-5";
  return <section className="space-y-5" aria-labelledby="outcome-title">
    <article className={card}>
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="outcome-title" className="text-xl font-semibold">成效跟踪</h2><p className="mt-1 text-sm text-slate-500">仅审核通过的本轮新增值进入正式统计。</p></div>{data.plan && <span className="rounded-full bg-blue-50 px-3 py-1 text-sm text-blue-700">{planStatus[data.plan.status] ?? data.plan.status}</span>}</div>
      {data.plan ? <dl className="grid gap-3 text-sm sm:grid-cols-3"><div><dt className="text-slate-500">跟踪策略</dt><dd className="mt-1 font-medium">{data.plan.trackingMode === "TRACKING" ? "需要跟踪" : "不跟踪"}</dd></div><div><dt className="text-slate-500">首次跟踪</dt><dd className="mt-1">{data.plan.firstTrackingDate ?? "—"}</dd></div><div><dt className="text-slate-500">下次跟踪</dt><dd className="mt-1">{data.plan.nextTrackingDate ?? "—"}</dd></div></dl> : <p className="text-sm text-amber-700">该历史已办结需求尚未设置成效跟踪策略。</p>}
      <div className="grid gap-3 border-t pt-4 sm:grid-cols-3"><div><p className="text-xs text-slate-500">合同金额</p><p className="mt-1 font-semibold">{moneyDisplay(data.approvedTotals.contractAmount)}</p></div><div><p className="text-xs text-slate-500">投资额</p><p className="mt-1 font-semibold">{moneyDisplay(data.approvedTotals.investmentAmount)}</p></div><div><p className="text-xs text-slate-500">政策资金</p><p className="mt-1 font-semibold">{moneyDisplay(data.approvedTotals.policyFund)}</p></div><div><p className="text-xs text-slate-500">降本金额</p><p className="mt-1 font-semibold">{moneyDisplay(data.approvedTotals.costReduction)}</p></div><div><p className="text-xs text-slate-500">引进人才</p><p className="mt-1 font-semibold">{data.approvedTotals.talentIntroduced}</p></div><div><p className="text-xs text-slate-500">专利</p><p className="mt-1 font-semibold">{data.approvedTotals.patents}</p></div></div>
    </article>

    {data.permissions.canCreatePlan && <form onSubmit={plan} className={card}><h3 className="text-lg font-semibold">设置成效跟踪策略</h3><div className="flex flex-wrap gap-5 text-sm"><label><input required type="radio" name="trackingMode" value="NONE" /> 不跟踪</label><label><input required type="radio" name="trackingMode" value="TRACKING" /> 需要跟踪</label></div><label className="block text-sm font-medium">首次跟踪日期（需要跟踪时必填）<input name="firstTrackingDate" type="date" className="mt-2 w-full rounded-xl border p-3" /></label><button disabled={pending} className="min-h-11 rounded-xl bg-blue-700 px-5 py-3 font-medium text-white disabled:opacity-50">正式建立计划</button></form>}

    {data.permissions.canCreateRound && <form onSubmit={createRound} className={card}><h3 className="text-lg font-semibold">填报本轮成效</h3><RoundFields /><button disabled={pending} className="min-h-11 rounded-xl bg-blue-700 px-5 py-3 font-medium text-white disabled:opacity-50">保存草稿</button></form>}

    <article className={card}><h3 className="text-lg font-semibold">历史轮次</h3>{data.rounds.length === 0 ? <p className="text-sm text-slate-500">暂无成效轮次。</p> : <ol className="space-y-5">{data.rounds.map((round) => <li key={round.id} className="rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap justify-between gap-2"><p className="font-semibold">第 {round.roundNo} 轮 · {round.trackingDate}</p><span className="rounded-full bg-slate-100 px-3 py-1 text-xs">{reviewStatus[round.reviewStatus] ?? round.reviewStatus}</span></div>
      <p className="mt-1 text-xs text-slate-500">实际跟踪批次：{round.trackingBatch.name}</p>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3"><div>合同 {moneyDisplay(round.contractAmountIncrement)}</div><div>投资 {moneyDisplay(round.investmentAmountIncrement)}</div><div>政策资金 {moneyDisplay(round.policyFundIncrement)}</div><div>降本 {moneyDisplay(round.costReductionIncrement)}</div><div>人才 {round.talentIntroducedIncrement}</div><div>专利 {round.patentIncrement}</div></dl>
      {round.qualitativeResult && <p className="mt-3 whitespace-pre-wrap text-sm"><span className="font-medium">定性成效：</span>{round.qualitativeResult}</p>}{round.enterpriseFeedback && <p className="mt-2 whitespace-pre-wrap text-sm"><span className="font-medium">企业反馈：</span>{round.enterpriseFeedback}</p>}
      <p className="mt-2 text-sm">{round.endTracking ? "本轮申请结束跟踪" : `下次跟踪：${round.nextTrackingDate ?? "—"}`}</p>
      {round.attachments.length > 0 && <ul className="mt-3 space-y-1 text-sm">{round.attachments.map((attachment) => <li key={attachment.id}>佐证：<AttachmentOpenButton id={attachment.id} label={attachment.originalFilename} /></li>)}</ul>}
      {round.returnReason && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">退回原因：{round.returnReason}</p>}{round.verifiedNote && <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">线下核实：{round.verifiedNote}</p>}
      {round.permissions.canUpdate && <form onSubmit={(event) => updateRound(event, round)} className="mt-4 space-y-4 rounded-xl bg-slate-50 p-4"><h4 className="font-medium">修改本轮草稿</h4><RoundFields round={round} /><button disabled={pending} className="min-h-11 rounded-xl border bg-white px-4 py-2 font-medium">保存修改</button></form>}
      {round.permissions.canSubmit && <button type="button" disabled={pending} onClick={() => void run(`submit:${round.id}`, () => post(`/api/v2/demand-outcomes/${round.id}/submit-review`, { expectedVersion: round.editVersion }, key(`submit:${round.id}`)))} className="mt-4 min-h-11 rounded-xl bg-blue-700 px-4 py-2 font-medium text-white">提交管理员审核</button>}
      {round.permissions.canReview && <form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void run(`approve:${round.id}`, () => post(`/api/v2/demand-outcomes/${round.id}/review`, { decision: "APPROVE", verifiedNote: value(form, "verifiedNote") || undefined }, key(`approve:${round.id}`))); }} className="mt-4 space-y-3 rounded-xl bg-emerald-50 p-4"><label className="block text-sm font-medium">线下核实说明（无佐证附件时必填）<textarea name="verifiedNote" maxLength={2000} rows={3} className="mt-2 w-full rounded-xl border bg-white p-3" /></label><label className="block text-sm font-medium">退回原因<textarea name="returnReason" maxLength={500} rows={2} className="mt-2 w-full rounded-xl border bg-white p-3" /></label><div className="flex flex-wrap gap-3"><button disabled={pending} className="min-h-11 rounded-xl bg-emerald-700 px-4 py-2 font-medium text-white">审核通过</button><button type="button" disabled={pending} onClick={(event) => { const form = event.currentTarget.form; if (!form) return; const reason = value(new FormData(form), "returnReason"); void run(`return:${round.id}`, () => post(`/api/v2/demand-outcomes/${round.id}/review`, { decision: "RETURN", reason }, key(`return:${round.id}`))); }} className="min-h-11 rounded-xl border border-red-300 bg-white px-4 py-2 font-medium text-red-700">退回修改</button></div></form>}
    </li>)}</ol>}</article>
    {message && <p role="status" className="rounded-xl bg-slate-100 p-3 text-sm">{message}</p>}
  </section>;
}
