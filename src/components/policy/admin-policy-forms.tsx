"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { uploadAttachmentToCos, type BrowserUploadIntent } from "@/modules/attachment/client/cos-browser-uploader";

type Option = { id: string; name: string };
type CoreDefaults = { title: string; issuingDepartment: string; publicationDate: string; level: string; applicationDeadline?: string | null; tagIds: string[] };

async function api(url: string, body: unknown) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json() as { ok: boolean; data?: { id?: string; status?: string }; error?: { message?: string } };
  if (!response.ok || !result.ok) throw new Error(result.error?.message ?? "操作失败");
  return result.data;
}

async function fileBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer()); let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

async function upload(file: File) {
  const intentResponse = await api("/api/v2/attachments/upload-intent", { filename: file.name, declaredMimeType: file.type || "application/octet-stream", expectedSizeBytes: file.size }) as BrowserUploadIntent & { attachmentId: string };
  if (intentResponse.upload.type === "TEST_MEMORY") await api(`/api/v2/test/attachments/${intentResponse.attachmentId}/upload`, { base64: await fileBase64(file) });
  else await uploadAttachmentToCos(intentResponse, file).promise;
  await api(`/api/v2/attachments/${intentResponse.attachmentId}/complete`, {});
  if (intentResponse.upload.type === "TEST_MEMORY") await api(`/api/v2/test/attachments/${intentResponse.attachmentId}/scan`, {});
  return intentResponse.attachmentId;
}

function coreFrom(data: FormData) {
  return { title: data.get("title"), issuingDepartment: data.get("issuingDepartment"), publicationDate: data.get("publicationDate"), level: data.get("level"), applicationDeadline: data.get("applicationDeadline") || null, tagIds: data.getAll("tagIds") };
}

function CoreFields({ tags, defaults }: { tags: Option[]; defaults?: CoreDefaults }) {
  return <><Field name="title" label="政策名称" required defaultValue={defaults?.title}/><Field name="issuingDepartment" label="发布部门" required defaultValue={defaults?.issuingDepartment}/><Field name="publicationDate" label="发布时间" type="date" required defaultValue={defaults?.publicationDate}/><Field name="level" label="发布层级" required placeholder="县级/市级/省级/国家级" defaultValue={defaults?.level}/><Field name="applicationDeadline" label="申报截止日期（可选，不自动判失效）" type="date" defaultValue={defaults?.applicationDeadline ?? undefined}/><fieldset className="rounded-xl border border-slate-200 p-3"><legend className="px-1 text-sm font-medium">标签</legend><div className="flex flex-wrap gap-3">{tags.map((tag) => <label key={tag.id} className="text-sm"><input name="tagIds" type="checkbox" value={tag.id} defaultChecked={defaults?.tagIds.includes(tag.id)} className="mr-1"/>{tag.name}</label>)}</div></fieldset></>;
}

export function AdminPolicyCreateForm({ tags }: { tags: Option[] }) {
  const router = useRouter(); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setMessage("正在上传并扫描附件…"); const data = new FormData(event.currentTarget); const primary = data.get("primary") as File; const supplementary = data.getAll("supplementary").filter((file): file is File => file instanceof File && file.size > 0);
    try { const primaryAttachmentId = await upload(primary); const supplementaryAttachmentIds = []; for (const file of supplementary) supplementaryAttachmentIds.push(await upload(file)); setMessage("正在创建政策草稿…"); const created = await api("/api/v2/admin/policies", { ...coreFrom(data), primaryAttachmentId, supplementaryAttachmentIds, content: {} }); router.push(`/admin/policies/${created?.id}`); }
    catch (error) { setMessage(error instanceof Error ? error.message : "操作失败"); } finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="grid gap-4 rounded-2xl border bg-white p-6 md:grid-cols-2"><CoreFields tags={tags}/><label className="text-sm font-medium">主政策文件<input name="primary" type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" required className="mt-1 block w-full rounded-xl border p-3"/></label><label className="text-sm font-medium">补充附件（可多选）<input name="supplementary" type="file" multiple accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" className="mt-1 block w-full rounded-xl border p-3"/></label><div className="md:col-span-2"><button disabled={busy} className="rounded-xl bg-blue-600 px-5 py-3 font-medium text-white">{busy ? "处理中…" : "创建政策草稿"}</button>{message && <p role="status" className="mt-2 text-sm text-slate-600">{message}</p>}</div></form>;
}

export function PolicyVersionForm({ policyId, tags, defaults }: { policyId: string; tags: Option[]; defaults: CoreDefaults }) {
  const router = useRouter(); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!confirm("新版本会保留全部旧文件和旧版本，确认继续？")) return; setBusy(true); const data = new FormData(event.currentTarget);
    try { const primaryAttachmentId = await upload(data.get("primary") as File); const supplementaryAttachmentIds = []; for (const file of data.getAll("supplementary")) if (file instanceof File && file.size) supplementaryAttachmentIds.push(await upload(file)); await api(`/api/v2/admin/policies/${policyId}/create-version`, { ...coreFrom(data), primaryAttachmentId, supplementaryAttachmentIds, content: {}, changeReason: data.get("changeReason") }); setMessage("新版本已建立，请重新人工确认后发布。"); router.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "操作失败"); } finally { setBusy(false); }
  }
  return <details className="rounded-2xl border bg-white p-5"><summary className="cursor-pointer font-semibold">建立新内容版本</summary><form onSubmit={submit} className="mt-4 grid gap-4 md:grid-cols-2"><CoreFields tags={tags} defaults={defaults}/><Field name="changeReason" label="版本变更原因" required/><label className="text-sm font-medium">新主政策文件<input name="primary" type="file" required className="mt-1 block w-full rounded-xl border p-3"/></label><label className="text-sm font-medium">新补充附件<input name="supplementary" type="file" multiple className="mt-1 block w-full rounded-xl border p-3"/></label><div className="md:col-span-2"><button disabled={busy} className="rounded-xl bg-slate-900 px-4 py-2 text-white">创建新版本</button>{message && <p className="mt-2 text-sm">{message}</p>}</div></form></details>;
}

export function PolicyInterpretationForm({ policyId, core, tags, interpretationId, candidate }: { policyId: string; core: CoreDefaults; tags: Option[]; interpretationId?: string; candidate?: Record<string, unknown> }) {
  const router = useRouter(); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  async function extract() { setBusy(true); try { const result = await api(`/api/v2/admin/policies/${policyId}/extract`, {}); setMessage(result?.status === "FAILED" ? "智能提取暂不可用，可继续完全手工录入并确认。" : "智能提取完成，请刷新并人工核对候选内容。"); router.refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "提取失败"); } finally { setBusy(false); } }
  async function confirmContent(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); const data = new FormData(event.currentTarget);
    try { await api(`/api/v2/admin/policies/${policyId}/confirm-interpretation`, { interpretationId, core: coreFrom(data), interpretation: { targetAudience: data.get("targetAudience"), supportContent: data.get("supportContent"), applicationConditions: data.get("applicationConditions"), keyClauses: String(data.get("keyClauses")).split("\n").map((x) => x.trim()).filter(Boolean), evidence: [{ field: "综合解读", value: String(data.get("evidenceValue")), page: Number(data.get("evidencePage")) || undefined, locator: data.get("evidenceLocator") || undefined }] } }); setMessage("人工确认已保存。"); router.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "确认失败"); } finally { setBusy(false); }
  }
  const value = (key: string) => typeof candidate?.[key] === "string" ? String(candidate[key]) : ""; const clauses = Array.isArray(candidate?.keyClauses) ? candidate.keyClauses.join("\n") : "";
  return <section className="rounded-2xl border border-blue-100 bg-blue-50/50 p-5"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-medium text-blue-700">AI 智能解读，仅供内部辅助</p><h2 className="mt-1 font-semibold">提取与人工确认</h2></div><button type="button" disabled={busy} onClick={extract} className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm text-blue-700">AI 提取</button></div><form onSubmit={confirmContent} className="mt-4 grid gap-4 md:grid-cols-2"><CoreFields tags={tags} defaults={core}/><TextArea name="targetAudience" label="适用对象" required defaultValue={value("targetAudience")}/><TextArea name="supportContent" label="支持内容" required defaultValue={value("supportContent")}/><TextArea name="applicationConditions" label="申报条件" required defaultValue={value("applicationConditions")}/><TextArea name="keyClauses" label="关键条款（每行一条）" required defaultValue={clauses}/><Field name="evidenceValue" label="原文依据摘要" required defaultValue="管理员已对照主政策文件核验"/><Field name="evidencePage" label="原文页码" type="number" min={1} defaultValue={1}/><Field name="evidenceLocator" label="证据位置" defaultValue="主政策文件"/><div className="md:col-span-2"><button disabled={busy} className="rounded-xl bg-blue-600 px-4 py-2 text-white">管理员人工确认</button>{message && <p role="status" className="mt-2 text-sm">{message}</p>}</div></form></section>;
}

export function PolicyGovernanceActions({ id, publicationStatus, publishedPolicies, activeRelations }: { id: string; publicationStatus: string; publishedPolicies: Option[]; activeRelations: Array<{ id: string; label: string }> }) {
  const router = useRouter(); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  async function act(url: string, body: unknown, confirmation?: string) { if (confirmation && !confirm(confirmation)) return; setBusy(true); try { await api(url, body); setMessage("操作成功"); router.refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "操作失败"); } finally { setBusy(false); } }
  return <section className="rounded-2xl border bg-white p-5"><h2 className="font-semibold">治理操作</h2><div className="mt-4 grid gap-4 lg:grid-cols-2">{publicationStatus === "DRAFT" && <button disabled={busy} onClick={() => act(`/api/v2/admin/policies/${id}/publish`, {}, "确认发布？AI 不会自动执行此操作。") } className="rounded-xl bg-emerald-600 px-4 py-3 text-white">发布政策</button>}{publicationStatus === "PUBLISHED" && <ReasonAction label="撤回政策" danger onSubmit={(reason) => act(`/api/v2/admin/policies/${id}/withdraw`, { reason }, "撤回不会自动恢复旧政策，确认继续？")}/>}<form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void act(`/api/v2/admin/policies/${id}/replacements`, { oldPolicyId: data.get("oldPolicyId"), reason: data.get("reason") }, "确认建立人工替代关系？"); }} className="space-y-2 rounded-xl border p-4"><p className="text-sm font-medium">建立替代关系</p><select name="oldPolicyId" required className="w-full rounded-lg border p-2"><option value="">选择旧政策</option>{publishedPolicies.filter((item) => item.id !== id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><input name="reason" required placeholder="正式依据/原因" className="w-full rounded-lg border p-2"/><button className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white">确认替代</button></form>{activeRelations.map((relation) => <form key={relation.id} onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void act(`/api/v2/admin/policy-replacements/${relation.id}/end`, { reason: data.get("reason"), restoreOldAsCurrent: data.get("restore") === "on" }, "解除关系不会默认恢复旧政策；请确认你的显式选择。") }} className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="text-sm font-medium">解除：{relation.label}</p><input name="reason" required placeholder="解除原因" className="w-full rounded-lg border p-2"/><label className="block text-sm"><input name="restore" type="checkbox" className="mr-2"/>明确恢复旧政策为现行</label><button className="rounded-lg bg-amber-700 px-3 py-2 text-sm text-white">解除关系</button></form>)}</div>{message && <p role="status" className="mt-3 text-sm">{message}</p>}</section>;
}

function ReasonAction({ label, danger, onSubmit }: { label: string; danger?: boolean; onSubmit: (reason: string) => void }) { return <form onSubmit={(event) => { event.preventDefault(); onSubmit(String(new FormData(event.currentTarget).get("reason"))); }} className="space-y-2 rounded-xl border p-4"><p className="text-sm font-medium">{label}</p><input name="reason" required placeholder="操作原因" className="w-full rounded-lg border p-2"/><button className={`rounded-lg px-3 py-2 text-sm text-white ${danger ? "bg-red-700" : "bg-blue-600"}`}>{label}</button></form>; }
function Field({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) { return <label className="text-sm font-medium">{label}<input {...props} className="mt-1 w-full rounded-xl border border-slate-200 p-3 font-normal"/></label>; }
function TextArea({ label, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) { return <label className="text-sm font-medium">{label}<textarea {...props} rows={4} className="mt-1 w-full rounded-xl border border-slate-200 p-3 font-normal"/></label>; }
