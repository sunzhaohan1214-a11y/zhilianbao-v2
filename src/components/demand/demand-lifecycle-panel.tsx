"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import type { DemandLifecycleService } from "@/modules/demand";
import { uploadFormalAttachments } from "./formal-attachment-upload";

type Overview = Awaited<ReturnType<DemandLifecycleService["overview"]>>;

async function post(path: string, body: unknown, idempotencyKey?: string) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message ?? "操作失败");
  return payload.data;
}

function value(form: FormData, name: string) {
  return String(form.get(name) ?? "").trim();
}

function shanghai(date: Date | string | null | undefined) {
  return date ? new Date(date).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "—";
}

const sourceLabel: Record<string, string> = {
  CURRENT_OWNER: "正式主责",
  COLLABORATOR: "当前协同人",
  TOWNSHIP_STAFF: "属地承接人",
  ALUMNI_PLATFORM: "平台往届团员",
  TOWNSHIP_PROXY: "代历届团员补录",
  ADMIN: "管理员代录",
};

export function DemandLifecyclePanel({ demandId, overview }: { demandId: string; overview: Overview }) {
  const router = useRouter();
  const keys = useRef<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [transferPreview, setTransferPreview] = useState<null | {
    oldOwner: { name: string };
    newOwner: { id: string; name: string };
    reason: string;
    activeCollaboratorCount: number;
    crossBatch: boolean;
    impact: string[];
    impactToken: string;
    expiresAt: string;
  }>(null);

  function key(action: string) {
    return keys.current[action] ??= crypto.randomUUID();
  }

  async function run(action: string, operation: () => Promise<unknown>) {
    setPending(true);
    setMessage("");
    if (action === "preview-transfer") setTransferPreview(null);
    try {
      await operation();
      delete keys.current[action];
      if (action !== "preview-transfer") setTransferPreview(null);
      setMessage("操作已完成。");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
    } finally {
      setPending(false);
    }
  }

  async function attachments(form: FormData) {
    const files = form.getAll("attachments").filter((item): item is File => item instanceof File && item.size > 0);
    return uploadFormalAttachments(files);
  }

  function submitProgress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run("progress", async () => post(`/api/v2/demands/${demandId}/progress`, {
      currentProgress: value(form, "currentProgress"),
      nextStep: value(form, "nextStep"),
      attachmentIds: await attachments(form),
      representedPersonId: value(form, "representedPersonId") || undefined,
    }, key("progress")));
  }

  function submitClose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run("close", async () => post(`/api/v2/demands/${demandId}/submit-close`, {
      solution: value(form, "solution"),
      connectedResources: value(form, "connectedResources"),
      attachmentIds: await attachments(form),
    }, key("close")));
  }

  function reviewClose(formElement: HTMLFormElement, decision: "APPROVE" | "RETURN") {
    const form = new FormData(formElement);
    void run("review-close", async () => {
      const trackingMode = value(form, "trackingMode");
      const outcomePlan = decision === "APPROVE"
        ? trackingMode === "TRACKING"
          ? { trackingMode, firstTrackingDate: value(form, "firstTrackingDate") }
          : trackingMode === "NONE" ? { trackingMode } : undefined
        : undefined;
      return post(`/api/v2/demands/${demandId}/review-close`, {
        decision,
        townshipVerificationResult: value(form, "townshipVerificationResult"),
        reason: value(form, "reason") || undefined,
        outcomePlan,
      });
    });
  }

  function reviewExit(formElement: HTMLFormElement, decision: "APPROVE" | "REJECT") {
    const form = new FormData(formElement);
    void run("review-exit", () => post(`/api/v2/demands/${demandId}/owner-exit/review`, {
      decision,
      reviewReason: value(form, "reviewReason") || undefined,
    }));
  }

  const field = "mt-2 w-full rounded-xl border border-slate-300 bg-white p-3";
  const card = "space-y-4 rounded-2xl border border-slate-200 bg-white p-5";

  return (
    <div className="space-y-5">
      <article className={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="text-lg font-semibold">跟进进展</h2><p className="mt-1 text-sm text-slate-500">上海自然日口径；超过 30 天未更新标记为需催办。</p></div>
          <span className={`rounded-full px-3 py-1 text-sm ${overview.freshness.stale ? "bg-amber-100 text-amber-800" : "bg-emerald-50 text-emerald-700"}`}>{overview.freshness.stale ? "超过 30 天，需催办" : "更新时效正常"}</span>
        </div>
        {overview.responsibility && <p className="rounded-xl bg-slate-50 p-3 text-sm">{overview.responsibility.mode === "CURRENT_OWNER"
          ? `当前正式主责：${overview.responsibility.owner.name}`
          : `属地经办：${overview.responsibility.townshipHandler.name}；往届协助：${overview.responsibility.alumniHelpers.map(({ name, helperKind }) => `${name}（${helperKind === "PLATFORM" ? "平台" : "线下"}）`).join("、")}`}</p>}
        <p className="text-xs text-slate-500">最近进展：{shanghai(overview.freshness.lastProgressAt)} · 当前责任起算：{shanghai(overview.freshness.responsibilityStartedAt)}</p>
        {overview.progresses.length === 0 ? <p className="text-sm text-slate-500">暂无进展记录。</p> : <ol className="space-y-4">{overview.progresses.map((item) => <li key={item.id} className="rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap justify-between gap-2 text-xs text-slate-500"><span>{sourceLabel[item.sourceType] ?? item.sourceType} · {item.createdByPerson.name}{item.representedPerson ? `（代 ${item.representedPerson.name}）` : ""}</span><time>{shanghai(item.createdAt)}</time></div><p className="mt-3 whitespace-pre-wrap text-sm leading-6"><span className="font-medium">当前进展：</span>{item.currentProgress}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6"><span className="font-medium">下一步：</span>{item.nextStep}</p>{item.attachments.length > 0 && <ul className="mt-3 text-sm text-blue-700">{item.attachments.map((attachment) => <li key={attachment.id}>附件：{attachment.originalFilename} · {attachment.scanStatus}</li>)}</ul>}</li>)}</ol>}
      </article>

      {overview.permissions.canAddProgress && <form onSubmit={submitProgress} className={card}><h2 className="text-lg font-semibold">新增进展</h2><label className="block text-sm font-medium">当前进展<textarea name="currentProgress" required maxLength={5000} rows={4} className={field} /></label><label className="block text-sm font-medium">下一步计划<textarea name="nextStep" required maxLength={5000} rows={3} className={field} /></label>{overview.permissions.canProxyHistorical && <label className="block text-sm font-medium">代历届团员补录（可选）<select name="representedPersonId" className={field}><option value="">本人提交</option>{overview.historicalProxyOptions.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>}<label className="block text-sm font-medium">附件<input name="attachments" type="file" multiple className={field} /></label><button disabled={pending} className="min-h-11 rounded-xl bg-blue-600 px-5 py-3 font-medium text-white disabled:opacity-50">提交进展</button></form>}

      {overview.permissions.canRemind && <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5"><h2 className="font-semibold text-amber-950">进展已超过 30 天未更新</h2><p className="mt-1 text-sm text-amber-800">同一需求每 7 个上海自然日最多催办一次。上次催办：{shanghai(overview.latestReminderAt)}</p><button type="button" disabled={pending} onClick={() => void run("remind", () => post(`/api/v2/demands/${demandId}/group-leader-remind`, {}))} className="mt-4 min-h-11 rounded-xl bg-amber-700 px-5 py-3 font-medium text-white disabled:opacity-50">发送催办</button></section>}

      {overview.permissions.canSubmitClose && <form onSubmit={submitClose} className={card}><h2 className="text-lg font-semibold">申请办结</h2><label className="block text-sm font-medium">解决情况<textarea name="solution" required maxLength={5000} rows={4} className={field} /></label><label className="block text-sm font-medium">已对接资源<textarea name="connectedResources" required maxLength={5000} rows={3} className={field} /></label><label className="block text-sm font-medium">办结附件<input name="attachments" type="file" multiple className={field} /></label><button disabled={pending} className="min-h-11 rounded-xl bg-emerald-600 px-5 py-3 font-medium text-white disabled:opacity-50">提交属地审核</button></form>}

      {overview.closeRequests.length > 0 && <article className={card}><h2 className="text-lg font-semibold">办结申请历史</h2><ol className="space-y-4">{overview.closeRequests.map((request) => <li key={request.id} className="rounded-xl border p-4"><p className="text-xs text-slate-500">第 {request.submissionNo} 次 · {request.submittedByPerson.name} · {shanghai(request.submittedAt)}</p><p className="mt-2 whitespace-pre-wrap text-sm"><span className="font-medium">解决情况：</span>{request.solution}</p><p className="mt-2 whitespace-pre-wrap text-sm"><span className="font-medium">对接资源：</span>{request.connectedResources}</p>{request.attachments.map((attachment) => <p key={attachment.id} className="mt-2 text-sm text-blue-700">附件：{attachment.originalFilename}</p>)}{request.reviews.map((review) => <div key={review.id} className="mt-3 rounded-lg bg-slate-50 p-3 text-sm"><p>{review.decision === "APPROVE" ? "审核通过" : "退回继续跟进"} · {review.reviewedByPerson.name} · {shanghai(review.reviewedAt)}</p><p className="mt-1 whitespace-pre-wrap">属地核验：{review.townshipVerificationResult}</p>{review.reason && <p className="mt-1 whitespace-pre-wrap text-red-700">原因：{review.reason}</p>}</div>)}</li>)}</ol></article>}

      {overview.permissions.canReviewClose && <form onSubmit={(event) => { event.preventDefault(); reviewClose(event.currentTarget, "APPROVE"); }} className="space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><h2 className="text-lg font-semibold text-emerald-950">属地办结审核</h2><label className="block text-sm font-medium">核验情况<textarea name="townshipVerificationResult" required maxLength={5000} rows={4} className={field} /></label><fieldset className="rounded-xl border border-emerald-200 bg-white p-4"><legend className="px-2 text-sm font-medium">成效跟踪（通过办结时必选）</legend><div className="mt-2 flex flex-wrap gap-5 text-sm"><label><input type="radio" name="trackingMode" value="NONE" required /> 不跟踪</label><label><input type="radio" name="trackingMode" value="TRACKING" required /> 需要跟踪</label></div><label className="mt-4 block text-sm font-medium">首次跟踪日期（需要跟踪时必填）<input name="firstTrackingDate" type="date" className={field} /></label></fieldset><label className="block text-sm font-medium">退回原因<textarea name="reason" maxLength={500} rows={2} className={field} /></label><div className="flex flex-wrap gap-3"><button disabled={pending} className="min-h-11 rounded-xl bg-emerald-700 px-5 py-3 font-medium text-white">确认办结并建立成效计划</button><button type="button" disabled={pending} onClick={(event) => { if (event.currentTarget.form) reviewClose(event.currentTarget.form, "RETURN"); }} className="min-h-11 rounded-xl border border-red-300 bg-white px-5 py-3 font-medium text-red-700">退回继续跟进</button></div></form>}

      {overview.permissions.canRequestOwnerExit && <form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void run("exit", () => post(`/api/v2/demands/${demandId}/owner-exit`, { reason: value(form, "reason") }, key("exit"))); }} className={card}><h2 className="text-lg font-semibold">申请退出主责</h2><p className="text-sm text-slate-500">审核通过后需求回到待认领；主责历史保留，当前协同关系结束。</p><label className="block text-sm font-medium">退出原因<textarea name="reason" required maxLength={500} rows={3} className={field} /></label><button disabled={pending} className="min-h-11 rounded-xl border border-amber-400 bg-white px-5 py-3 font-medium text-amber-800">提交退出申请</button></form>}

      {overview.ownerExitRequests.length > 0 && <article className={card}><h2 className="text-lg font-semibold">主责退出记录</h2><ol className="space-y-3">{overview.ownerExitRequests.map((request) => <li key={request.id} className="rounded-xl bg-slate-50 p-3 text-sm"><p className="font-medium">{request.ownerPerson.name} · {request.status}</p><p className="mt-1 whitespace-pre-wrap">{request.reason}</p><p className="mt-1 text-xs text-slate-500">申请：{shanghai(request.requestedAt)}{request.reviewedAt ? ` · 审核：${shanghai(request.reviewedAt)} ${request.reviewedByPerson?.name ?? ""}` : ""}</p>{request.reviewReason && <p className="mt-1 text-red-700">审核意见：{request.reviewReason}</p>}</li>)}</ol></article>}

      {overview.permissions.canReviewOwnerExit && <form onSubmit={(event) => { event.preventDefault(); reviewExit(event.currentTarget, "APPROVE"); }} className="space-y-4 rounded-2xl border border-amber-200 bg-amber-50 p-5"><h2 className="text-lg font-semibold text-amber-950">审核主责退出</h2><label className="block text-sm font-medium">审核意见<textarea name="reviewReason" maxLength={500} rows={3} className={field} /></label><div className="flex flex-wrap gap-3"><button disabled={pending} className="min-h-11 rounded-xl bg-amber-700 px-5 py-3 font-medium text-white">同意退出</button><button type="button" disabled={pending} onClick={(event) => { if (event.currentTarget.form) reviewExit(event.currentTarget.form, "REJECT"); }} className="min-h-11 rounded-xl border border-red-300 bg-white px-5 py-3 font-medium text-red-700">拒绝退出</button></div></form>}

      {overview.permissions.canTransferOwner && <form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const reason = value(form, "reason"); const newOwnerPersonId = value(form, "newOwnerPersonId"); void run("preview-transfer", async () => { const preview = await post(`/api/v2/demands/${demandId}/transfer-owner/preview`, { newOwnerPersonId, reason }); setTransferPreview({ ...preview, reason }); }); }} className="space-y-4 rounded-2xl border border-red-200 bg-red-50 p-5"><h2 className="text-lg font-semibold text-red-950">SUPER_ADMIN 强制转交主责</h2><p className="text-sm text-red-800">高风险操作。先生成实时影响预览，再在 10 分钟内确认执行。</p><label className="block text-sm font-medium">新主责<select name="newOwnerPersonId" required className={field}><option value="">请选择当前合法在任团员</option>{overview.transferCandidates.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label className="block text-sm font-medium">转交原因<textarea name="reason" required maxLength={500} rows={3} className={field} /></label><button disabled={pending} className="min-h-11 rounded-xl border border-red-400 bg-white px-5 py-3 font-medium text-red-800">生成影响预览</button></form>}

      {transferPreview && <section className="space-y-3 rounded-2xl border-2 border-red-400 bg-white p-5"><h2 className="text-lg font-semibold text-red-950">确认转交影响</h2><p className="text-sm">{transferPreview.oldOwner.name} → {transferPreview.newOwner.name}；当前协同人数 {transferPreview.activeCollaboratorCount}；{transferPreview.crossBatch ? "跨届转交" : "同届转交"}。</p><ul className="list-disc pl-5 text-sm">{transferPreview.impact.map((item) => <li key={item}>{item}</li>)}</ul><p className="text-xs text-slate-500">预览有效期至 {shanghai(transferPreview.expiresAt)}</p><button type="button" disabled={pending} onClick={() => void run("transfer", () => post(`/api/v2/demands/${demandId}/transfer-owner`, { newOwnerPersonId: transferPreview.newOwner.id, reason: transferPreview.reason, impactToken: transferPreview.impactToken, confirmation: "CONFIRM" }, key("transfer")))} className="min-h-11 rounded-xl bg-red-700 px-5 py-3 font-medium text-white">我已核对，确认强制转交</button></section>}

      {overview.permissions.canCancel && <form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const reason = value(form, "reason"); if (window.confirm("确认取消该需求？关联待办与责任关系将关闭，操作不可撤销。")) void run("cancel", () => post(`/api/v2/demands/${demandId}/cancel`, { reason })); }} className="space-y-4 rounded-2xl border border-red-200 bg-red-50 p-5"><h2 className="text-lg font-semibold text-red-950">取消需求</h2><label className="block text-sm font-medium">取消原因<textarea name="reason" required maxLength={500} rows={3} className={field} /></label><button disabled={pending} className="min-h-11 rounded-xl bg-red-700 px-5 py-3 font-medium text-white">取消需求</button></form>}

      {overview.status === "COMPLETED" && <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><h2 className="font-semibold text-emerald-950">需求已办结</h2><p className="mt-1 text-sm text-emerald-800">办结时间：{shanghai(overview.completedAt)} · 归属届次：{overview.completionBatchId ?? "—"}</p></section>}
      {overview.status === "CANCELED" && <section className="rounded-2xl border border-slate-300 bg-slate-100 p-5"><h2 className="font-semibold">需求已取消</h2><p className="mt-1 text-sm">{overview.canceledReason} · {shanghai(overview.canceledAt)}</p></section>}
      {message && <p role="status" className="rounded-xl bg-slate-100 p-3 text-sm">{message}</p>}
    </div>
  );
}
