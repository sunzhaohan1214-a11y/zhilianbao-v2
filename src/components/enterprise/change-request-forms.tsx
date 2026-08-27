"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

type Option = { id: string; name: string };

async function submitJson(url: string, body: unknown) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json() as { ok: boolean; error?: { message?: string } };
  if (!response.ok || !payload.ok) throw new Error(payload.error?.message ?? "提交失败，请重试");
  return payload;
}

export function EnterpriseApplicationForm({ areas, tags }: { areas: Option[]; tags: Option[] }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const data = new FormData(event.currentTarget);
    const areaId = String(data.get("responsibleAreaId"));
    try {
      await submitJson("/api/v2/enterprise-change-requests", { requestType: "CREATE", proposedAreaId: areaId, payload: { enterprise: {
        name: data.get("name"), responsibleAreaId: areaId, address: data.get("address"), creditCode: data.get("creditCode") || undefined,
        legalRepresentative: data.get("legalRepresentative") || undefined, introduction: data.get("introduction") || undefined,
        mainProducts: data.get("mainProducts"), qualificationsHonors: data.get("qualificationsHonors") || undefined,
        tagIds: data.getAll("tagIds"),
      } } });
      setMessage("申请已提交，等待管理员审核。"); event.currentTarget.reset(); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "提交失败"); } finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="space-y-4 rounded-2xl bg-white p-5 shadow-sm">
    <Field name="name" label="企业名称" required />
    <label className="block text-sm font-medium">所属区域<select name="responsibleAreaId" required className="mt-1 w-full rounded-xl border border-slate-200 p-3"><option value="">请选择</option>{areas.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
    <Field name="address" label="企业地址" required />
    <Field name="creditCode" label="统一社会信用代码（可选）" />
    <Field name="legalRepresentative" label="法定代表人（可选）" />
    <TextArea name="mainProducts" label="主要产品/服务" required />
    <TextArea name="introduction" label="企业简介（可选）" />
    <TextArea name="qualificationsHonors" label="资质荣誉（可选）" />
    {tags.length > 0 && <fieldset><legend className="text-sm font-medium">企业标签</legend><div className="mt-2 flex flex-wrap gap-3">{tags.map((tag) => <label key={tag.id} className="text-sm"><input type="checkbox" name="tagIds" value={tag.id} className="mr-1" />{tag.name}</label>)}</div></fieldset>}
    <button disabled={busy || areas.length === 0} className="w-full rounded-xl bg-blue-600 px-4 py-3 font-medium text-white disabled:opacity-50">{busy ? "提交中…" : "提交企业新增申请"}</button>
    {areas.length === 0 && <p className="text-sm text-amber-700">当前账号没有可提交的属地区域。</p>}{message && <p role="status" className="text-sm text-blue-700">{message}</p>}
  </form>;
}

export function EnterpriseCorrectionForm({ enterpriseId, baseVersion, name, address, mainProducts }: { enterpriseId: string; baseVersion: number; name: string; address: string; mainProducts: string }) {
  const [open, setOpen] = useState(false); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(""); const data = new FormData(event.currentTarget);
    try { await submitJson("/api/v2/enterprise-change-requests", { requestType: "CORRECTION", targetEnterpriseId: enterpriseId, baseEnterpriseVersion: baseVersion, payload: { changes: { name: data.get("name"), address: data.get("address"), mainProducts: data.get("mainProducts") } } }); setMessage("纠错申请已提交。"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "提交失败"); } finally { setBusy(false); }
  }
  if (!open) return <button onClick={() => setOpen(true)} className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700">提交纠错</button>;
  return <form onSubmit={submit} className="mt-4 space-y-3 rounded-2xl border border-blue-100 bg-blue-50/50 p-4"><Field name="name" label="企业名称" defaultValue={name} required /><Field name="address" label="企业地址" defaultValue={address} required /><TextArea name="mainProducts" label="主要产品/服务" defaultValue={mainProducts} required /><button disabled={busy} className="rounded-xl bg-blue-600 px-4 py-2 text-white">{busy ? "提交中…" : "确认提交"}</button>{message && <p role="status" className="text-sm">{message}</p>}</form>;
}

function Field({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) { return <label className="block text-sm font-medium">{label}<input {...props} className="mt-1 w-full rounded-xl border border-slate-200 p-3 font-normal" /></label>; }
function TextArea({ label, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) { return <label className="block text-sm font-medium">{label}<textarea {...props} rows={4} className="mt-1 w-full rounded-xl border border-slate-200 p-3 font-normal" /></label>; }
