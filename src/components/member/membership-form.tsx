"use client";
import { useState } from "react";
export function MembershipForm({ personId, batches, organizations }: { personId: string; batches: Array<{ id: string; name: string }>; organizations: Array<{ id: string; name: string; type: string }> }) {
  const [message, setMessage] = useState("");
  async function submit(formData: FormData) {
    const nullable = (name: string) => String(formData.get(name) ?? "") || null;
    const response = await fetch(`/api/v2/admin/members/${personId}/memberships`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ batchId: formData.get("batchId"), dispatchOrganizationId: nullable("dispatchOrganizationId"), postOrganizationId: nullable("postOrganizationId"), positionTitle: String(formData.get("positionTitle") ?? ""), startDate: formData.get("startDate"), endDate: nullable("endDate"), status: "ACTIVE" }) });
    const payload = await response.json(); setMessage(response.ok ? "批次履历已添加，请刷新页面" : payload.error?.message ?? "保存失败");
  }
  return <form action={submit} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-2">
    <select name="batchId" required className="rounded-lg border p-2"><option value="">选择批次</option>{batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.name}</option>)}</select>
    <input name="positionTitle" maxLength={100} placeholder="职务文本（不会自动转为角色）" className="rounded-lg border p-2" />
    <select name="dispatchOrganizationId" className="rounded-lg border p-2"><option value="">派出单位</option>{organizations.filter(({ type }) => type === "DISPATCH_UNIT").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
    <select name="postOrganizationId" className="rounded-lg border p-2"><option value="">挂职单位</option>{organizations.filter(({ type }) => type === "POST_UNIT").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
    <input name="startDate" type="date" required className="rounded-lg border p-2" /><input name="endDate" type="date" className="rounded-lg border p-2" />
    <button className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white">添加批次履历</button><p role="status" className="text-sm text-slate-600">{message}</p>
  </form>;
}
