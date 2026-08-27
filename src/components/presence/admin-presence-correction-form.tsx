"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function AdminPresenceCorrectionForm({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [arrivalAt, setArrivalAt] = useState("");
  const [expectedDepartureAt, setExpectedDepartureAt] = useState("");
  const [origin, setOrigin] = useState("");
  const [cancelAction, setCancelAction] = useState<"KEEP" | "CANCEL" | "UNCANCEL">("KEEP");
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setMessage("");
    const changes: Record<string, string | null> = {};
    if (arrivalAt) changes.arrivalAt = `${arrivalAt}:00+08:00`;
    if (expectedDepartureAt) changes.expectedDepartureAt = `${expectedDepartureAt}:00+08:00`;
    if (origin) changes.origin = origin;
    if (cancelAction === "CANCEL") { changes.canceledAt = new Date().toISOString(); changes.cancelReason = reason; }
    if (cancelAction === "UNCANCEL") changes.canceledAt = null;
    if (Object.keys(changes).length === 0) { setMessage("请至少填写一个纠错时间"); return; }
    const response = await fetch(`/api/v2/admin/presence/${reportId}/correct`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ changes, reason }),
    });
    const payload = await response.json() as { error?: { message?: string } };
    if (!response.ok) { setMessage(payload.error?.message ?? "纠错失败"); return; }
    setReason(""); setArrivalAt(""); setExpectedDepartureAt(""); setOrigin(""); setCancelAction("KEEP"); router.refresh();
  }
  return <details className="mt-2"><summary className="cursor-pointer text-sm text-blue-700">正式纠错</summary>
    <form onSubmit={submit} className="mt-3 grid gap-2 rounded-xl bg-slate-50 p-3 md:grid-cols-3">
      <input aria-label="纠错到宝时间" type="datetime-local" value={arrivalAt} onChange={(e) => setArrivalAt(e.target.value)} className="rounded-lg border p-2 text-sm" />
      <input aria-label="纠错预计离宝时间" type="datetime-local" value={expectedDepartureAt} onChange={(e) => setExpectedDepartureAt(e.target.value)} className="rounded-lg border p-2 text-sm" />
      <input aria-label="纠错原因" required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="线下核实原因（必填）" className="rounded-lg border p-2 text-sm" />
      <input aria-label="纠错来源地" maxLength={200} value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="来源地（需要时修改）" className="rounded-lg border p-2 text-sm" />
      <select aria-label="纠错取消状态" value={cancelAction} onChange={(e) => setCancelAction(e.target.value as "KEEP" | "CANCEL" | "UNCANCEL")} className="rounded-lg border p-2 text-sm"><option value="KEEP">不改取消状态</option><option value="CANCEL">正式取消</option><option value="UNCANCEL">撤销错误取消</option></select>
      {message && <p role="alert" className="text-sm text-red-600 md:col-span-3">{message}</p>}
      <button className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white md:col-span-3">提交正式纠错</button>
    </form>
  </details>;
}
