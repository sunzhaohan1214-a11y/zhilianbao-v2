"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type Contact = { id: string; name: string; positionTitle: string | null; phone: string };

async function command(path: string, body: Record<string, unknown>) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message ?? "操作失败");
  return payload.data;
}

function value(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

export function DemandLeadActions({
  leadId,
  status,
  enterpriseId,
  contacts,
  canRestore,
}: {
  leadId: string;
  status: string;
  enterpriseId: string | null;
  contacts: Contact[];
  canRestore: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const terminal = ["MERGED", "CLOSED", "CONVERTED"].includes(status);

  async function run(action: () => Promise<unknown>) {
    setPending(true);
    setMessage("");
    try {
      await action();
      setMessage("操作已完成。");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
    } finally {
      setPending(false);
    }
  }

  function supplement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    return run(() => command(`/api/v2/demand-leads/${leadId}/add-info`, {
      action: "ADD_SUPPLEMENT",
      note: value(form, "note") || undefined,
      verifiedTitle: value(form, "verifiedTitle") || undefined,
      verifiedDescription: value(form, "verifiedDescription") || undefined,
      demandType: value(form, "demandType") || undefined,
      urgency: value(form, "urgency") || undefined,
      selectedContactId: value(form, "selectedContactId") || undefined,
    }));
  }

  function requestMore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    return run(() => command(`/api/v2/demand-leads/${leadId}/add-info`, {
      action: "REQUEST_MORE_INFO",
      note: value(form, "reason"),
    }));
  }

  function linkEnterprise(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    return run(() => command(`/api/v2/demand-leads/${leadId}/link-enterprise`, {
      enterpriseId: value(form, "enterpriseId"),
    }));
  }

  function merge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!window.confirm("合并后本线索将只读并指向主线索，确认继续？")) return;
    const form = new FormData(event.currentTarget);
    return run(() => command(`/api/v2/demand-leads/${leadId}/merge`, {
      targetLeadId: value(form, "targetLeadId"),
      reason: value(form, "reason"),
      confirmation: "CONFIRM",
    }));
  }

  function close(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    return run(() => command(`/api/v2/demand-leads/${leadId}/close`, { reason: value(form, "reason") }));
  }

  function restore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!window.confirm("仅用于恢复误关闭线索，确认继续？")) return;
    const form = new FormData(event.currentTarget);
    return run(() => command(`/api/v2/demand-leads/${leadId}/restore`, {
      reason: value(form, "reason"),
      confirmation: "CONFIRM",
    }));
  }

  function convert(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!window.confirm("将创建正式需求 DRAFT；本任务不会提交审核或发布。确认转换？")) return;
    const form = new FormData(event.currentTarget);
    return run(() => command(`/api/v2/demand-leads/${leadId}/convert-to-draft`, {
      selectedContactId: value(form, "selectedContactId"),
      title: value(form, "title"),
      originalDescription: value(form, "originalDescription"),
      demandType: value(form, "demandType"),
      urgency: value(form, "urgency"),
      internalNote: value(form, "internalNote") || undefined,
      confirmation: "CONFIRM",
    }));
  }

  if (terminal && !(status === "CLOSED" && canRestore)) {
    return <p className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">该线索已进入终态，原始来源和附件保持只读。</p>;
  }

  const formClass = "space-y-3 rounded-2xl border border-slate-200 bg-white p-4";
  const inputClass = "w-full rounded-xl border border-slate-300 p-3 text-sm";
  const buttonClass = "min-h-11 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50";

  return (
    <div className="space-y-4">
      {status === "PENDING_ENTERPRISE_LINK" && <form onSubmit={linkEnterprise} className={formClass}>
        <h3 className="font-semibold">关联正式企业</h3>
        <p className="text-xs text-slate-500">只允许 NORMAL 企业；原始企业名称不会被覆盖。</p>
        <input name="enterpriseId" required placeholder="正式 Enterprise ID" className={inputClass} />
        <button disabled={pending} className={buttonClass}>确认关联</button>
      </form>}

      {!terminal && <form onSubmit={supplement} className={formClass}>
        <h3 className="font-semibold">追加核验 / 补充</h3>
        <input name="verifiedTitle" maxLength={200} placeholder="核验后的标题（不覆盖原始标题）" className={inputClass} />
        <textarea name="verifiedDescription" maxLength={5000} placeholder="核验后的正式描述" rows={4} className={inputClass} />
        <div className="grid gap-3 sm:grid-cols-2">
          <select name="demandType" className={inputClass}><option value="">需求类型（可稍后）</option><option value="TECHNICAL">技术攻关</option><option value="TALENT">人才合作</option><option value="PROJECT">项目落地</option><option value="OTHER">其他需求</option></select>
          <select name="urgency" className={inputClass}><option value="">紧急程度（可稍后）</option><option value="NORMAL">普通</option><option value="URGENT">紧急</option></select>
        </div>
        {contacts.length > 0 && <select name="selectedContactId" className={inputClass}><option value="">本次联系人（可稍后）</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name} · {contact.phone}</option>)}</select>}
        <textarea name="note" maxLength={2000} placeholder="补充说明" rows={2} className={inputClass} />
        <button disabled={pending} className={buttonClass}>保存追加记录</button>
      </form>}

      {status === "PENDING_TOWNSHIP_VERIFY" && <form onSubmit={requestMore} className={formClass}>
        <h3 className="font-semibold">标记待补充</h3>
        <textarea name="reason" required maxLength={2000} placeholder="需要补充的内容" rows={2} className={inputClass} />
        <button disabled={pending} className={buttonClass}>进入待补充</button>
      </form>}

      {status === "PENDING_TOWNSHIP_VERIFY" && enterpriseId && contacts.length > 0 && <form onSubmit={convert} className="space-y-3 rounded-2xl border-2 border-blue-200 bg-blue-50 p-4">
        <h3 className="font-semibold text-blue-950">转正式需求草稿</h3>
        <p className="text-xs text-blue-800">高影响操作：只创建 DRAFT，不提交审核、不发布。</p>
        <select name="selectedContactId" required className={inputClass}><option value="">选择有效联系人</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name} · {contact.phone}</option>)}</select>
        <input name="title" required maxLength={200} placeholder="人工填写正式标题" className={inputClass} />
        <textarea name="originalDescription" required maxLength={5000} placeholder="核验后的正式原始描述" rows={5} className={inputClass} />
        <div className="grid gap-3 sm:grid-cols-2"><select name="demandType" required className={inputClass}><option value="">选择需求类型</option><option value="TECHNICAL">技术攻关</option><option value="TALENT">人才合作</option><option value="PROJECT">项目落地</option><option value="OTHER">其他需求</option></select><select name="urgency" required defaultValue="NORMAL" className={inputClass}><option value="NORMAL">普通</option><option value="URGENT">紧急</option></select></div>
        <textarea name="internalNote" maxLength={2000} placeholder="内部补充说明（可选）" rows={2} className={inputClass} />
        <button disabled={pending} className="min-h-11 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">确认转换 DRAFT</button>
      </form>}

      {!terminal && <div className="grid gap-4 md:grid-cols-2">
        <form onSubmit={merge} className={formClass}><h3 className="font-semibold">合并到主线索</h3><input name="targetLeadId" required placeholder="主 Lead ID" className={inputClass} /><textarea name="reason" required maxLength={500} placeholder="合并原因" className={inputClass} /><button disabled={pending} className={buttonClass}>预览并确认合并</button></form>
        <form onSubmit={close} className={formClass}><h3 className="font-semibold">关闭线索</h3><textarea name="reason" required maxLength={500} placeholder="关闭原因" className={inputClass} /><button disabled={pending} className={buttonClass}>关闭</button></form>
      </div>}

      {status === "CLOSED" && canRestore && <form onSubmit={restore} className={formClass}><h3 className="font-semibold">管理员恢复误关闭</h3><textarea name="reason" required maxLength={500} placeholder="恢复原因" className={inputClass} /><button disabled={pending} className={buttonClass}>确认恢复</button></form>}
      {message && <p role="status" className="rounded-xl bg-slate-100 p-3 text-sm text-slate-700">{message}</p>}
    </div>
  );
}
