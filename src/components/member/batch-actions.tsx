"use client";
import { useState } from "react";

type BatchActionsProps = {
  batches: Array<{ id: string; name: string; isCurrent: boolean; status: string }>;
  members: Array<{ id: string; name: string }>;
  canSwitchCurrentBatch: boolean;
  canAssignGroupLeader: boolean;
  canCloseBatch: boolean;
};

export function BatchActions({ batches, members, canSwitchCurrentBatch, canAssignGroupLeader, canCloseBatch }: BatchActionsProps) {
  const [message, setMessage] = useState("");
  async function activate(batchId: string) {
    setMessage("读取影响范围…");
    const previewResponse = await fetch(`/api/v2/admin/batches/${batchId}/activate`);
    const preview = await previewResponse.json();
    if (!previewResponse.ok) return setMessage(preview.error?.message ?? "无法读取影响范围");
    const reason = window.prompt("请输入批次切换原因（切换前必须完成云快照）");
    if (!reason || !window.confirm(`${preview.data.warning}\n备份状态：${preview.data.backupReadiness.provider.status}\n确认切换到 ${preview.data.target.name}？`)) return setMessage("已取消");
    const response = await fetch(`/api/v2/admin/batches/${batchId}/activate`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ confirmation: "ACTIVATE", confirm: true, reason, expectedCurrentBatchId: preview.data.expectedCurrentBatchId, previewToken: preview.data.previewToken }) });
    const payload = await response.json(); setMessage(response.ok ? "当前批次已切换，请刷新页面" : payload.error?.message ?? "切换失败");
  }
  async function leader(formData: FormData) {
    const batchId = String(formData.get("batchId")); const personId = String(formData.get("personId"));
    const response = await fetch(`/api/v2/admin/batches/${batchId}/group-leader`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "ASSIGN", personId, reason: String(formData.get("reason")) }) });
    const payload = await response.json(); setMessage(response.ok ? "团长已任命，请刷新页面" : payload.error?.message ?? "任命失败");
  }
  async function revoke(batchId: string) {
    const reason = window.prompt("请输入撤销原因");
    if (!reason) return;
    const response = await fetch(`/api/v2/admin/batches/${batchId}/group-leader`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "REVOKE", reason }) });
    const payload = await response.json(); setMessage(response.ok ? "团长任命已撤销，请刷新页面" : payload.error?.message ?? "撤销失败");
  }
  async function close(batchId: string) {
    const reason = window.prompt("请输入关闭原因");
    if (!reason) return;
    const response = await fetch(`/api/v2/admin/batches/${batchId}/close`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) });
    const payload = await response.json(); setMessage(response.ok ? "批次已关闭，请刷新页面" : payload.error?.message ?? "关闭失败");
  }
  return <div className="space-y-5">
    <div className="flex flex-wrap gap-2">{batches.filter((batch) => !batch.isCurrent && batch.status !== "CLOSED").map((batch) => <span key={batch.id} className="flex gap-2">{canSwitchCurrentBatch && <button onClick={() => activate(batch.id)} className="rounded-lg border border-amber-300 px-3 py-2 text-sm text-amber-800">切换至 {batch.name}</button>}{canCloseBatch && <button onClick={() => close(batch.id)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">关闭 {batch.name}</button>}</span>)}</div>
    {canAssignGroupLeader && <>
      <form action={leader} className="grid gap-3 rounded-xl border border-slate-200 p-4 sm:grid-cols-3">
        <select name="batchId" required className="rounded-lg border p-2"><option value="">当前批次</option>{batches.filter(({ isCurrent }) => isCurrent).map((batch) => <option key={batch.id} value={batch.id}>{batch.name}</option>)}</select>
        <select name="personId" required className="rounded-lg border p-2"><option value="">选择团员</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select>
        <input name="reason" required maxLength={500} placeholder="任命原因" className="rounded-lg border p-2" />
        <button className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white">任命团长</button>
      </form>
      <div>{batches.filter(({ isCurrent }) => isCurrent).map((batch) => <button key={batch.id} type="button" onClick={() => revoke(batch.id)} className="rounded-lg border border-red-300 px-3 py-2 text-sm text-red-700">撤销当前团长</button>)}</div>
    </>}
    <p role="status" className="text-sm text-slate-600">{message}</p>
  </div>;
}
