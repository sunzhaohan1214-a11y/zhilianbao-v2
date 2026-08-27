"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type Visit = { id: string; enterpriseName: string };
type Node = { id: string; label: string; enterprise: boolean };

async function post(url: string, body?: unknown, idempotent = false) {
  const response = await fetch(url, {
    method: "POST",
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(idempotent ? { "idempotency-key": crypto.randomUUID() } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json() as { ok: boolean; error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message ?? "操作失败，请稍后重试");
  return payload;
}

export function TripActions({
  tripId, actorPersonId, status, isParticipant, canCancel, canSubmitResult, canEditResult, canCreateLead, nodes, visits,
}: {
  tripId: string;
  actorPersonId: string;
  status: string;
  isParticipant: boolean;
  canCancel: boolean;
  canSubmitResult: boolean;
  canEditResult: boolean;
  canCreateLead: boolean;
  nodes: Node[];
  visits: Visit[];
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  async function act(operation: () => Promise<unknown>) {
    setPending(true); setMessage("");
    try { await operation(); router.refresh(); } catch (error) { setMessage((error as Error).message); }
    finally { setPending(false); }
  }
  async function cancel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    await act(() => post(`/api/v2/trips/${tripId}/cancel`, { reason: data.get("reason") }));
  }
  async function result(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    await act(() => post(`/api/v2/trips/${tripId}/result`, {
      resultSummary: data.get("resultSummary"), nextStep: data.get("nextStep") || undefined,
      nodeResults: nodes.filter(({ enterprise }) => enterprise).map(({ id }) => ({ tripNodeId: id, resultSummary: data.get(`node-${id}`) || undefined })),
      attachmentIds: [],
    }, true));
  }
  async function updateResult(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    await act(() => post(`/api/v2/trips/${tripId}/result/update`, { resultSummary: data.get("resultSummary"), nextStep: data.get("nextStep") || undefined, attachmentIds: [] }));
  }
  async function supplement(event: FormEvent<HTMLFormElement>, visitId: string) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    await act(() => post(`/api/v2/visits/${visitId}/supplements`, { content: data.get("content"), attachmentIds: [] }));
    event.currentTarget.reset();
  }
  async function lead(event: FormEvent<HTMLFormElement>, visitId: string) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    await act(() => post(`/api/v2/visits/${visitId}/demand-leads`, {
      title: data.get("title"), description: data.get("description"), note: data.get("note") || undefined, attachmentIds: [],
    }, true));
    event.currentTarget.reset();
  }
  const formClass = "mt-4 space-y-3 rounded-2xl border border-black/10 bg-white p-4";
  const fieldClass = "w-full rounded-xl border border-black/10 px-3 py-2";
  return <section className="mt-6">
    {message && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{message}</p>}
    {!isParticipant && !["COMPLETED", "CANCELED"].includes(status) && <button disabled={pending} onClick={() => act(() => post(`/api/v2/trips/${tripId}/participants`, { personId: actorPersonId }))} className="rounded-xl bg-blue-600 px-4 py-2 text-sm text-white">加入行程</button>}
    {isParticipant && !["COMPLETED", "CANCELED"].includes(status) && <button disabled={pending} onClick={() => act(() => post(`/api/v2/trips/${tripId}/participants/leave`))} className="rounded-xl border px-4 py-2 text-sm">退出行程</button>}
    {canCancel && status !== "COMPLETED" && status !== "CANCELED" && <form onSubmit={cancel} className={formClass}><h3 className="font-medium">取消行程</h3><input required name="reason" maxLength={500} placeholder="取消原因" className={fieldClass} /><button disabled={pending} className="rounded-xl bg-red-600 px-4 py-2 text-sm text-white">确认取消</button></form>}
    {canSubmitResult && ["IN_PROGRESS", "PENDING_RESULT"].includes(status) && <form onSubmit={result} className={formClass}><h3 className="font-medium">填写共享结果</h3><textarea required name="resultSummary" maxLength={10000} rows={4} placeholder="结果简述（必填）" className={fieldClass} /><textarea name="nextStep" maxLength={5000} rows={2} placeholder="下一步安排（选填）" className={fieldClass} />{nodes.filter(({ enterprise }) => enterprise).map((node) => <textarea key={node.id} name={`node-${node.id}`} maxLength={5000} rows={2} placeholder={`${node.label}独立走访结果（选填）`} className={fieldClass} />)}<button disabled={pending} className="rounded-xl bg-blue-600 px-4 py-2 text-sm text-white">提交并完成</button></form>}
    {canEditResult && status === "COMPLETED" && <form onSubmit={updateResult} className={formClass}><h3 className="font-medium">补充或修改共享结果</h3><textarea required name="resultSummary" maxLength={10000} rows={3} placeholder="更新后的结果简述" className={fieldClass} /><textarea name="nextStep" maxLength={5000} rows={2} placeholder="下一步安排（选填）" className={fieldClass} /><button disabled={pending} className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white">保存结果修改</button></form>}
    {visits.map((visit) => <div key={visit.id} className="mt-5 rounded-2xl bg-slate-50 p-4"><h3 className="font-medium">{visit.enterpriseName}</h3><form onSubmit={(event) => supplement(event, visit.id)} className="mt-3 space-y-2"><textarea required name="content" maxLength={5000} rows={2} placeholder="追加走访补充（不会覆盖他人内容）" className={fieldClass} /><button disabled={pending} className="rounded-xl border bg-white px-3 py-2 text-sm">追加补充</button></form>{canCreateLead && <form onSubmit={(event) => lead(event, visit.id)} className="mt-4 space-y-2 border-t pt-4"><p className="text-sm font-medium">发现新需求</p><input required name="title" maxLength={200} placeholder="需求标题" className={fieldClass} /><textarea required name="description" maxLength={5000} rows={3} placeholder="需求描述" className={fieldClass} /><textarea name="note" maxLength={2000} rows={2} placeholder="补充说明（选填）" className={fieldClass} /><p className="text-xs text-slate-500">走访阶段不填写需求类型和紧急程度，由镇区核验时补充。</p><button disabled={pending} className="rounded-xl bg-amber-600 px-4 py-2 text-sm text-white">创建需求线索</button></form>}</div>)}
  </section>;
}
