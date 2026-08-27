"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { uploadFormalAttachments } from "./formal-attachment-upload";
import type { DirectDemandSourceType } from "@/modules/demand";

type Area = { id: string; name: string };
type EnterpriseOption = { id: string; name: string; responsibleArea: Area };
type EnterpriseDetail = EnterpriseOption & {
  contacts: { id: string; name: string; positionTitle: string | null; phone: string; status: string }[];
};

export function FormalDemandCreateForm({ areas, sourceType }: { areas: Area[]; sourceType: DirectDemandSourceType }) {
  const router = useRouter();
  const searchVersion = useRef(0);
  const [options, setOptions] = useState<EnterpriseOption[]>([]);
  const [enterprise, setEnterprise] = useState<EnterpriseDetail | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function search(keyword: string) {
    setEnterprise(null);
    const version = ++searchVersion.current;
    if (keyword.trim().length < 2) return setOptions([]);
    const response = await fetch(`/api/v2/enterprises?keyword=${encodeURIComponent(keyword.trim())}&pageSize=10`);
    const payload = await response.json();
    if (version !== searchVersion.current) return;
    if (!response.ok) throw new Error(payload.error?.message ?? "企业搜索失败");
    setOptions(payload.data.items as EnterpriseOption[]);
  }

  async function choose(option: EnterpriseOption) {
    setOptions([]);
    const response = await fetch(`/api/v2/enterprises/${option.id}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message ?? "企业详情加载失败");
    setEnterprise(payload.data as EnterpriseDetail);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enterprise) return setMessage("请先从搜索结果选择正式企业。");
    const form = new FormData(event.currentTarget);
    setPending(true);
    setMessage("");
    try {
      const files = form.getAll("attachments").filter((item): item is File => item instanceof File && item.size > 0);
      const attachmentIds = await uploadFormalAttachments(files);
      const response = await fetch("/api/v2/demands", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceType,
          enterpriseId: enterprise.id,
          selectedContactId: form.get("selectedContactId"),
          title: form.get("title"),
          originalDescription: form.get("originalDescription"),
          demandType: form.get("demandType"),
          urgency: form.get("urgency"),
          responsibleAreaId: form.get("responsibleAreaId"),
          internalNote: String(form.get("internalNote") ?? "") || undefined,
          attachmentIds,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "创建正式需求草稿失败");
      router.push(`${sourceType === "ADMIN_DIRECT" ? "/admin" : ""}/demands/${payload.data.id}`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建失败");
    } finally {
      setPending(false);
    }
  }

  const field = "mt-2 w-full rounded-xl border border-slate-300 bg-white p-3";
  const activeContacts = enterprise?.contacts.filter(({ status }) => status === "ACTIVE") ?? [];
  return (
    <form onSubmit={submit} className="mt-6 max-w-3xl space-y-5 rounded-2xl border border-slate-200 bg-white p-6">
      <label className="block text-sm font-medium">Enterprise
        <input aria-label="企业名称搜索" placeholder="输入正式企业名称搜索" className={field} onChange={(event) => void search(event.target.value).catch((error) => setMessage(error instanceof Error ? error.message : "企业搜索失败"))} />
      </label>
      {options.length > 0 && <ul className="divide-y rounded-xl border">{options.map((option) => <li key={option.id}><button type="button" className="w-full p-3 text-left hover:bg-slate-50" onClick={() => void choose(option).catch((error) => setMessage(error instanceof Error ? error.message : "企业详情加载失败"))}>{option.name} · {option.responsibleArea.name}</button></li>)}</ul>}
      {enterprise && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">已选择：{enterprise.name}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium">本次选定联系人<select name="selectedContactId" required disabled={!enterprise} className={field}><option value="">请选择 ACTIVE 联系人</option>{activeContacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name} · {contact.phone}</option>)}</select></label>
        <label className="text-sm font-medium">负责区域<select name="responsibleAreaId" required defaultValue={enterprise?.responsibleArea.id ?? ""} key={enterprise?.id ?? "none"} className={field}><option value="">请选择</option>{areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label>
      </div>
      <label className="block text-sm font-medium">标题<input name="title" required maxLength={200} className={field} /></label>
      <label className="block text-sm font-medium">企业原始需求描述<textarea name="originalDescription" required maxLength={5000} rows={7} className={field} /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium">需求类型<select name="demandType" required className={field}><option value="">请选择</option><option value="TECHNICAL">技术攻关</option><option value="TALENT">人才合作</option><option value="PROJECT">项目落地</option><option value="OTHER">其他需求</option></select></label>
        <label className="text-sm font-medium">紧急程度<select name="urgency" defaultValue="NORMAL" className={field}><option value="NORMAL">普通</option><option value="URGENT">紧急</option></select></label>
      </div>
      <label className="block text-sm font-medium">正式需求附件（可选）<input name="attachments" type="file" multiple className={field} /></label>
      <label className="block text-sm font-medium">内部补充说明（可选）<textarea name="internalNote" maxLength={2000} rows={3} className={field} /></label>
      <button disabled={pending || !enterprise || activeContacts.length === 0} className="min-h-11 rounded-xl bg-blue-600 px-5 py-3 font-medium text-white disabled:opacity-50">{pending ? "创建中…" : "创建正式需求草稿"}</button>
      {message && <p role="alert" className="text-sm text-red-600">{message}</p>}
    </form>
  );
}
