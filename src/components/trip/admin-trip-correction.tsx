"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

async function submitJson(url: string, body: unknown) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json() as { error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message ?? "纠错失败");
}

export function AdminTripCorrection({ trip }: { trip: { id: string; title: string; purpose: string; note: string | null } }) {
  const router = useRouter(); const [message, setMessage] = useState(""); const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setMessage(""); const data = new FormData(event.currentTarget);
    try {
      await submitJson(`/api/v2/admin/trips/${trip.id}/correct`, { changes: { title: data.get("title"), purpose: data.get("purpose"), note: data.get("note") || null }, reason: data.get("reason") });
      router.refresh();
    } catch (error) { setMessage((error as Error).message); } finally { setPending(false); }
  }
  return <details className="mt-3"><summary className="cursor-pointer text-sm text-blue-700">正式纠错</summary><form onSubmit={submit} className="mt-3 grid gap-2"><input required name="title" defaultValue={trip.title} className="rounded-lg border p-2" /><textarea required name="purpose" defaultValue={trip.purpose} className="rounded-lg border p-2" /><textarea name="note" defaultValue={trip.note ?? ""} className="rounded-lg border p-2" /><input required name="reason" placeholder="纠错原因（必填）" className="rounded-lg border p-2" />{message && <p className="text-sm text-red-600">{message}</p>}<button disabled={pending} className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white">保存纠错</button></form></details>;
}

export function AdminVisitCorrection({ visit }: { visit: { id: string; visitSummary: string | null } }) {
  const router = useRouter(); const [message, setMessage] = useState(""); const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setMessage(""); const data = new FormData(event.currentTarget);
    try {
      await submitJson(`/api/v2/admin/visits/${visit.id}/correct`, { changes: { visitSummary: data.get("visitSummary") || null }, reason: data.get("reason") });
      router.refresh();
    } catch (error) { setMessage((error as Error).message); } finally { setPending(false); }
  }
  return <details className="mt-2"><summary className="cursor-pointer text-sm text-blue-700">走访纠错</summary><form onSubmit={submit} className="mt-2 grid gap-2"><textarea name="visitSummary" defaultValue={visit.visitSummary ?? ""} className="rounded-lg border p-2" /><input required name="reason" placeholder="纠错原因（必填）" className="rounded-lg border p-2" />{message && <p className="text-sm text-red-600">{message}</p>}<button disabled={pending} className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white">保存走访纠错</button></form></details>;
}
