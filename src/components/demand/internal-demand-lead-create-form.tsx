"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function InternalDemandLeadCreateForm({ areas }: { areas: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/v2/demand-leads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        responsibleAreaId: form.get("responsibleAreaId"),
        rawEnterpriseName: form.get("rawEnterpriseName"),
        rawContactName: String(form.get("rawContactName") ?? "") || undefined,
        rawContactPhone: String(form.get("rawContactPhone") ?? "") || undefined,
        rawTitle: form.get("rawTitle"), rawContent: form.get("rawContent"), sourceChannel: "INTERNAL_OTHER", attachmentIds: [],
      }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "创建失败");
      router.push(`/admin/demand-leads/${payload.data.id}`); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "创建失败"); } finally { setPending(false); }
  }
  const field = "w-full rounded-xl border border-slate-300 p-3";
  return <form onSubmit={submit} className="mt-6 max-w-2xl space-y-4 rounded-2xl border bg-white p-6"><label className="block text-sm font-medium">负责区域<select name="responsibleAreaId" required className={`mt-2 ${field}`}><option value="">请选择</option>{areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label><label className="block text-sm font-medium">原始企业名称<input name="rawEnterpriseName" required maxLength={200} className={`mt-2 ${field}`} /></label><div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">原始联系人<input name="rawContactName" maxLength={80} className={`mt-2 ${field}`} /></label><label className="block text-sm font-medium">原始联系电话<input name="rawContactPhone" maxLength={30} className={`mt-2 ${field}`} /></label></div><label className="block text-sm font-medium">原始需求标题<input name="rawTitle" required maxLength={200} className={`mt-2 ${field}`} /></label><label className="block text-sm font-medium">原始需求内容<textarea name="rawContent" required maxLength={5000} rows={6} className={`mt-2 ${field}`} /></label><button disabled={pending} className="min-h-11 rounded-xl bg-blue-600 px-5 py-3 font-medium text-white disabled:opacity-50">{pending ? "创建中…" : "创建其他来源线索"}</button>{message && <p className="text-sm text-red-600">{message}</p>}</form>;
}
