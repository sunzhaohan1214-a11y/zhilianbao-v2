"use client";

import { useRef, useState, type FormEvent } from "react";
import { uploadAttachmentToCos, type BrowserUploadIntent } from "@/modules/attachment/client/cos-browser-uploader";

type PublicAttachmentIntent = BrowserUploadIntent & { attachmentId: string; uploadToken: string };
type PublicAttachmentReference = { attachmentId: string; uploadToken: string };
type SubmissionAttempt = {
  fingerprint: string;
  idempotencyKey: string;
  attachments: PublicAttachmentReference[];
};

export function PublicDemandForm({ responsibleAreaId }: { responsibleAreaId: string }) {
  const formStartedAt = useRef(new Date().toISOString());
  const attempt = useRef<SubmissionAttempt | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [referenceNo, setReferenceNo] = useState("");

  async function uploadFiles(files: File[]): Promise<PublicAttachmentReference[]> {
    const references: PublicAttachmentReference[] = [];
    for (const file of files) {
      const intentResponse = await fetch("/api/v2/public/demand-leads/attachments/upload-intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          declaredMimeType: file.type || "application/octet-stream",
          expectedSizeBytes: file.size,
          responsibleAreaId,
        }),
      });
      const intentPayload = await intentResponse.json();
      if (!intentResponse.ok) throw new Error(intentPayload.error?.message ?? "附件上传申请失败");
      const intent = intentPayload.data as PublicAttachmentIntent;
      await uploadAttachmentToCos(intent, file).promise;
      const completeResponse = await fetch(`/api/v2/public/demand-leads/attachments/${intent.attachmentId}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uploadToken: intent.uploadToken }),
      });
      const completePayload = await completeResponse.json();
      if (!completeResponse.ok) throw new Error(completePayload.error?.message ?? "附件确认失败");
      references.push({ attachmentId: intent.attachmentId, uploadToken: intent.uploadToken });
    }
    return references;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setPending(true);
    setMessage("");
    try {
      const form = new FormData(formElement);
      const files = form.getAll("attachments").filter((item): item is File => item instanceof File && item.size > 0);
      const basePayload = {
        responsibleAreaId,
        enterpriseName: form.get("enterpriseName"),
        contactName: form.get("contactName"),
        contactPhone: form.get("contactPhone"),
        title: form.get("title"),
        description: form.get("description"),
        truthConfirmed: form.get("truthConfirmed") === "on",
        contactConsent: form.get("contactConsent") === "on",
        formStartedAt: formStartedAt.current,
        website: form.get("website"),
      };
      const fingerprint = JSON.stringify({
        ...basePayload,
        files: files.map((file) => ({ name: file.name, size: file.size, type: file.type, lastModified: file.lastModified })),
      });
      if (!attempt.current || attempt.current.fingerprint !== fingerprint) {
        attempt.current = {
          fingerprint,
          idempotencyKey: crypto.randomUUID(),
          attachments: await uploadFiles(files),
        };
      }
      const response = await fetch("/api/v2/public/demand-leads", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": attempt.current.idempotencyKey,
        },
        body: JSON.stringify({
          ...basePayload,
          attachments: attempt.current.attachments,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "提交失败，请稍后再试");
      setReferenceNo(payload.data.referenceNo);
      setMessage(payload.data.message);
      formElement.reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "提交失败，请稍后再试");
    } finally {
      setPending(false);
    }
  }

  if (referenceNo) {
    return (
      <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-8 text-center">
        <p className="text-sm font-medium text-emerald-700">提交成功</p>
        <h2 className="mt-2 text-2xl font-semibold text-emerald-950">参考编号 {referenceNo}</h2>
        <p className="mt-3 text-emerald-800">{message}</p>
        <p className="mt-2 text-sm text-emerald-700">公开入口不提供内部处理进度查询。</p>
      </section>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="text-sm font-medium text-slate-700">企业名称
          <input name="enterpriseName" required maxLength={200} className="mt-2 w-full rounded-xl border border-slate-300 p-3" />
        </label>
        <label className="text-sm font-medium text-slate-700">联系人
          <input name="contactName" required maxLength={80} className="mt-2 w-full rounded-xl border border-slate-300 p-3" />
        </label>
        <label className="text-sm font-medium text-slate-700">联系电话
          <input name="contactPhone" required maxLength={30} inputMode="tel" className="mt-2 w-full rounded-xl border border-slate-300 p-3" />
        </label>
        <label className="text-sm font-medium text-slate-700">需求标题
          <input name="title" required maxLength={200} className="mt-2 w-full rounded-xl border border-slate-300 p-3" />
        </label>
      </div>
      <label className="block text-sm font-medium text-slate-700">需求描述
        <textarea name="description" required maxLength={5000} rows={7} className="mt-2 w-full rounded-xl border border-slate-300 p-3" />
      </label>
      <label className="block text-sm font-medium text-slate-700">图片、PDF 或 Word（可选，单个不超过 50MB）
        <input name="attachments" type="file" multiple accept="image/jpeg,image/png,image/heic,application/pdf,.doc,.docx,.xls,.xlsx" className="mt-2 block w-full rounded-xl border border-slate-300 p-3" />
      </label>
      <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
      <label className="flex items-start gap-3 text-sm text-slate-700"><input name="truthConfirmed" type="checkbox" required className="mt-1" />我确认以上信息真实。</label>
      <label className="flex items-start gap-3 text-sm text-slate-700"><input name="contactConsent" type="checkbox" required className="mt-1" />我同意镇区工作人员联系核实。</label>
      <button disabled={pending} className="min-h-11 w-full rounded-xl bg-blue-600 px-5 py-3 font-medium text-white disabled:opacity-50">
        {pending ? "正在安全提交…" : "提交需求线索"}
      </button>
      {message && <p role="alert" className="text-sm text-red-600">{message}</p>}
    </form>
  );
}
