"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function PresenceCancelForm({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setPending(true); setMessage("");
    const response = await fetch(`/api/v2/presence/${reportId}/cancel`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }),
    });
    const payload = await response.json() as { error?: { message?: string } };
    setPending(false);
    if (!response.ok) { setMessage(payload.error?.message ?? "取消失败"); return; }
    router.refresh();
  }
  return <form onSubmit={submit} className="mt-3 flex flex-wrap gap-2">
    <input aria-label="取消原因" required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="填写取消原因" className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm" />
    <button disabled={pending} className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 disabled:opacity-50">{pending ? "取消中…" : "取消记录"}</button>
    {message && <p role="alert" className="w-full text-sm text-red-600">{message}</p>}
  </form>;
}
