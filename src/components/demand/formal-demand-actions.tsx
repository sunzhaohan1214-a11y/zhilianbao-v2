"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { uploadFormalAttachments } from "./formal-attachment-upload";

type Area = { id: string; name: string };
type Contact = { id: string; name: string; positionTitle: string | null; phone: string; status: string };
type Enterprise = { id: string; name: string; responsibleArea: Area; contacts: Contact[] };

async function command(path: string, body: unknown, headers?: Record<string, string>) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message ?? "操作失败");
  return payload.data;
}

function text(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

export function FormalDemandActions({
  demand,
  areas,
  canEdit,
  canSubmit,
  canReview,
  canDirectPublish,
}: {
  demand: {
    id: string;
    status: string;
    enterprise: { id: string; name: string; responsibleAreaId: string };
    selectedContact: Contact;
    responsibleAreaId: string;
    title: string;
    originalDescription: string;
    demandType: string;
    urgency: string;
    internalNote: string | null;
    attachments: { id: string; originalFilename: string; relationType: string }[];
  };
  areas: Area[];
  canEdit: boolean;
  canSubmit: boolean;
  canReview: boolean;
  canDirectPublish: boolean;
}) {
  const router = useRouter();
  const submitKey = useRef(crypto.randomUUID());
  const searchVersion = useRef(0);
  const [enterprise, setEnterprise] = useState<Enterprise>({
    ...demand.enterprise,
    responsibleArea: areas.find(({ id }) => id === demand.enterprise.responsibleAreaId) ?? { id: demand.enterprise.responsibleAreaId, name: "当前区域" },
    contacts: [demand.selectedContact],
  });
  const [enterpriseOptions, setEnterpriseOptions] = useState<Enterprise[]>([]);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function run(operation: () => Promise<unknown>) {
    setPending(true);
    setMessage("");
    try {
      await operation();
      setMessage("操作已完成。");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
    } finally {
      setPending(false);
    }
  }

  async function searchEnterprise(keyword: string) {
    const version = ++searchVersion.current;
    if (keyword.trim().length < 2) return setEnterpriseOptions([]);
    const response = await fetch(`/api/v2/enterprises?keyword=${encodeURIComponent(keyword.trim())}&pageSize=10`);
    const payload = await response.json();
    if (version !== searchVersion.current) return;
    if (!response.ok) throw new Error(payload.error?.message ?? "企业搜索失败");
    setEnterpriseOptions(payload.data.items as Enterprise[]);
  }

  async function chooseEnterprise(option: Enterprise) {
    const response = await fetch(`/api/v2/enterprises/${option.id}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message ?? "企业详情加载失败");
    setEnterprise(payload.data as Enterprise);
    setEnterpriseOptions([]);
  }

  function updateDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    return run(async () => {
      const files = form.getAll("attachments").filter((item): item is File => item instanceof File && item.size > 0);
      const uploadedIds = await uploadFormalAttachments(files);
      const retainedIds = demand.attachments
        .filter(({ relationType }) => relationType === "FORMAL_ATTACHMENT")
        .filter(({ id }) => form.get(`retain-${id}`) === "on")
        .map(({ id }) => id);
      return command(`/api/v2/demands/${demand.id}/update-draft`, {
        enterpriseId: enterprise.id,
        selectedContactId: text(form, "selectedContactId"),
        responsibleAreaId: text(form, "responsibleAreaId"),
        title: text(form, "title"),
        originalDescription: text(form, "originalDescription"),
        demandType: text(form, "demandType"),
        urgency: text(form, "urgency"),
        internalNote: text(form, "internalNote"),
        attachmentIds: [...retainedIds, ...uploadedIds],
      });
    });
  }

  function submitReview() {
    return run(() => command(`/api/v2/demands/${demand.id}/submit-review`, {}, {
      "Idempotency-Key": submitKey.current,
    }));
  }

  function reviewForm(formElement: HTMLFormElement, decision: "APPROVE" | "RETURN") {
    const form = new FormData(formElement);
    return run(() => command(`/api/v2/demands/${demand.id}/review`, {
      decision,
      reason: text(form, "reason") || undefined,
      demandType: text(form, "demandType"),
      urgency: text(form, "urgency"),
    }));
  }

  const field = "mt-2 w-full rounded-xl border border-slate-300 bg-white p-3";
  const card = "space-y-4 rounded-2xl border border-slate-200 bg-white p-5";
  const activeContacts = enterprise.contacts.filter(({ status }) => status === "ACTIVE");

  return (
    <div className="space-y-4">
      {canEdit && <form onSubmit={updateDraft} className={card}>
        <div><h2 className="text-lg font-semibold">编辑草稿</h2><p className="mt-1 text-sm text-slate-500">仅 DRAFT / RETURNED；联系人变化会同步刷新未发布快照。</p></div>
        <label className="block text-sm font-medium">Enterprise 搜索<input aria-label="编辑企业名称搜索" placeholder="输入名称可更换企业" className={field} onChange={(event) => void searchEnterprise(event.target.value).catch((error) => setMessage(error instanceof Error ? error.message : "企业搜索失败"))} /></label>
        {enterpriseOptions.length > 0 && <ul className="divide-y rounded-xl border">{enterpriseOptions.map((option) => <li key={option.id}><button type="button" className="w-full p-3 text-left" onClick={() => void chooseEnterprise(option).catch((error) => setMessage(error instanceof Error ? error.message : "企业加载失败"))}>{option.name}</button></li>)}</ul>}
        <p className="rounded-xl bg-slate-50 p-3 text-sm">当前企业：{enterprise.name}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">本次联系人<select name="selectedContactId" required defaultValue={enterprise.id === demand.enterprise.id ? demand.selectedContact.id : ""} key={enterprise.id} className={field}><option value="">请选择 ACTIVE 联系人</option>{activeContacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name} · {contact.phone}</option>)}</select></label>
          <label className="text-sm font-medium">负责区域<select name="responsibleAreaId" required defaultValue={demand.responsibleAreaId} className={field}>{areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label>
        </div>
        <label className="block text-sm font-medium">标题<input name="title" required maxLength={200} defaultValue={demand.title} className={field} /></label>
        <label className="block text-sm font-medium">企业原始需求描述<textarea name="originalDescription" required maxLength={5000} rows={6} defaultValue={demand.originalDescription} className={field} /></label>
        <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">类型<select name="demandType" defaultValue={demand.demandType} className={field}><option value="TECHNICAL">技术攻关</option><option value="TALENT">人才合作</option><option value="PROJECT">项目落地</option><option value="OTHER">其他需求</option></select></label><label className="text-sm font-medium">紧急程度<select name="urgency" defaultValue={demand.urgency} className={field}><option value="NORMAL">普通</option><option value="URGENT">紧急</option></select></label></div>
        <label className="block text-sm font-medium">内部补充说明<textarea name="internalNote" maxLength={2000} rows={3} defaultValue={demand.internalNote ?? ""} className={field} /></label>
        {demand.attachments.some(({ relationType }) => relationType === "FORMAL_ATTACHMENT") && <fieldset className="space-y-2"><legend className="text-sm font-medium">保留本次正式附件</legend>{demand.attachments.filter(({ relationType }) => relationType === "FORMAL_ATTACHMENT").map((attachment) => <label key={attachment.id} className="flex gap-2 text-sm"><input type="checkbox" name={`retain-${attachment.id}`} defaultChecked />{attachment.originalFilename}</label>)}</fieldset>}
        <label className="block text-sm font-medium">新增正式附件<input name="attachments" type="file" multiple className={field} /></label>
        <button disabled={pending || activeContacts.length === 0} className="min-h-11 rounded-xl bg-slate-900 px-5 py-3 text-white disabled:opacity-50">保存草稿修改</button>
      </form>}

      {canSubmit && <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5"><h2 className="font-semibold text-blue-950">提交管理员审核</h2><p className="mt-1 text-sm text-blue-800">提交后核心字段和附件集合冻结；退回后可继续修改。</p><button type="button" disabled={pending} onClick={() => void submitReview()} className="mt-4 min-h-11 rounded-xl bg-blue-600 px-5 py-3 font-medium text-white disabled:opacity-50">提交审核</button></section>}

      {canReview && <form onSubmit={(event) => { event.preventDefault(); void reviewForm(event.currentTarget, "APPROVE"); }} className={card}><h2 className="text-lg font-semibold">管理员审核</h2><p className="text-sm text-slate-500">只可调整辅助字段。核心字段有问题请退回，不在审核页直接修改。</p><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">类型<select name="demandType" defaultValue={demand.demandType} className={field}><option value="TECHNICAL">技术攻关</option><option value="TALENT">人才合作</option><option value="PROJECT">项目落地</option><option value="OTHER">其他需求</option></select></label><label className="text-sm font-medium">紧急程度<select name="urgency" defaultValue={demand.urgency} className={field}><option value="NORMAL">普通</option><option value="URGENT">紧急</option></select></label></div><textarea name="reason" maxLength={500} placeholder="退回原因（退回时必填）" className={field} /><div className="flex flex-wrap gap-3"><button disabled={pending} className="min-h-11 rounded-xl bg-emerald-600 px-5 py-3 font-medium text-white">审核通过并立即发布</button><button type="button" disabled={pending} onClick={(event) => { const form = event.currentTarget.form; if (form) void reviewForm(form, "RETURN"); }} className="min-h-11 rounded-xl border border-red-300 bg-white px-5 py-3 font-medium text-red-700">退回修改</button></div></form>}

      {canDirectPublish && <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5"><h2 className="font-semibold text-amber-950">管理员代录直发</h2><p className="mt-1 text-sm text-amber-800">仅 ADMIN_DIRECT DRAFT；发布前会再次锁定并校验企业、联系人和附件。</p><button type="button" disabled={pending} onClick={() => void run(() => command(`/api/v2/demands/${demand.id}/direct-publish`, {}))} className="mt-4 min-h-11 rounded-xl bg-amber-700 px-5 py-3 font-medium text-white">确认直接发布</button></section>}
      {message && <p role="status" className="rounded-xl bg-slate-100 p-3 text-sm">{message}</p>}
    </div>
  );
}
