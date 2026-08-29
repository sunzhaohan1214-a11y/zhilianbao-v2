"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type CandidateSummary = {
  id: string;
  name: string;
  maskedPhone?: string | null;
  personStatus?: string;
  accountStatus?: string | null;
  areaName?: string;
  creditCodeMasked?: string | null;
  organizationName?: string;
  professionalDirection?: string;
  status?: string;
};
type Row = {
  id: string;
  rowNumber: number;
  action: string;
  resolutionStatus: string;
  normalizedJson: Record<string, string>;
  candidateJson: { candidateIds?: string[]; candidates?: CandidateSummary[] } | null;
  issuesJson: Array<{ code: string; field?: string; severity: string; message: string }>;
};
type Batch = {
  id: string;
  importType: "ENTERPRISE" | "MEMBER" | "TALENT";
  status: string;
  sheetName: string | null;
  previewVersion: number;
  blockingRowCount: number;
  sheets: string[];
  mappingColumns: Array<{ sourceColumn: number; sourceHeader: string; targetField: string | null }>;
  rows: Row[];
};

const fields = {
  ENTERPRISE: [["name", "企业名称"], ["creditCode", "信用代码"], ["responsibleArea", "负责区域"], ["address", "地址"], ["legalRepresentative", "法定代表人"], ["introduction", "企业简介"], ["mainProducts", "主营产品"], ["qualificationsHonors", "资质荣誉"], ["contactName", "联系人姓名"], ["contactPosition", "联系人职务"], ["contactPhone", "联系人电话"], ["contactPrimary", "是否主要联系人"]],
  MEMBER: [["name", "姓名"], ["phone", "手机号"], ["batch", "批次"], ["memberKind", "成员类型"], ["dispatchOrganization", "派出单位"], ["postOrganization", "挂职单位"], ["positionTitle", "任职职务"], ["startDate", "开始日期"], ["endDate", "结束日期"], ["professionalDirection", "专业方向"], ["coordinatableResources", "可协调资源"], ["createAccount", "创建账号"]],
  TALENT: [["name", "姓名"], ["scopeType", "人才范围"], ["organizationName", "工作单位"], ["title", "职务职称"], ["professionalDirection", "专业方向"], ["workEducationExperience", "工作教育经历"], ["representativeAchievements", "代表性成果"], ["originalRecommender", "原推荐人"]],
} as const;

class ApiError extends Error {
  constructor(readonly code: string | undefined, message: string) { super(message); }
}
async function api(path: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const payload = await response.json();
  if (!response.ok) throw new ApiError(payload.error?.code, payload.error?.message ?? "操作失败");
  return payload.data;
}
function statusLabel(status: string | null | undefined) {
  return ({ ACTIVE: "有效", ARCHIVED: "已归档", NORMAL: "正常", DISABLED: "已停用", MERGED: "已合并", PENDING_ENABLE: "待启用", UNACTIVATED: "未激活" } as Record<string, string>)[status ?? ""] ?? (status || "无");
}
function rowCandidates(row: Row): CandidateSummary[] {
  if (Array.isArray(row.candidateJson?.candidates) && row.candidateJson.candidates.length) return row.candidateJson.candidates;
  return (row.candidateJson?.candidateIds ?? []).map((id, index) => ({ id, name: `候选对象 ${index + 1}` }));
}
function CandidateCard({ candidate, importType }: { candidate: CandidateSummary; importType: Batch["importType"] }) {
  const inactive = candidate.personStatus === "ARCHIVED" || candidate.status === "DISABLED" || candidate.status === "MERGED";
  return <div className={`rounded-xl border p-3 ${inactive ? "border-amber-200 bg-amber-50" : "bg-slate-50"}`}>
    <p className="font-medium text-slate-900">{candidate.name}</p>
    {importType === "MEMBER" && <p className="mt-1 text-xs text-slate-600">{candidate.maskedPhone ?? "无手机号"} · 档案：{statusLabel(candidate.personStatus)} · 账号：{statusLabel(candidate.accountStatus)}</p>}
    {importType === "ENTERPRISE" && <p className="mt-1 text-xs text-slate-600">{candidate.areaName ?? "区域未知"} · 信用代码：{candidate.creditCodeMasked ?? "无"} · 状态：{statusLabel(candidate.status)}</p>}
    {importType === "TALENT" && <p className="mt-1 text-xs text-slate-600">{candidate.organizationName ?? "单位未知"} · {candidate.professionalDirection ?? "方向未知"} · 状态：{statusLabel(candidate.status)}</p>}
  </div>;
}

export function ImportBatchActions({ batch }: { batch: Batch }) {
  const router = useRouter();
  const [mapping, setMapping] = useState(batch.mappingColumns);
  const [selectedSheet, setSelectedSheet] = useState(batch.sheets[0] ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [corrections, setCorrections] = useState<Record<string, Record<string, string>>>({});
  const [filter, setFilter] = useState<"ALL" | "REVIEW" | "ERROR" | "EXECUTABLE">("ALL");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [previewReviewed, setPreviewReviewed] = useState(false);
  const [confirmKey, setConfirmKey] = useState("");
  const [confirmReason, setConfirmReason] = useState("");
  const reviewRows = useMemo(() => batch.rows.filter((row) => ["NEEDS_REVIEW", "BLOCKED"].includes(row.resolutionStatus)), [batch.rows]);
  const filteredRows = useMemo(() => batch.rows.filter((row) => filter === "ALL" || (filter === "REVIEW" && row.resolutionStatus === "NEEDS_REVIEW") || (filter === "ERROR" && row.resolutionStatus === "BLOCKED") || (filter === "EXECUTABLE" && !["NEEDS_REVIEW", "BLOCKED"].includes(row.resolutionStatus))), [batch.rows, filter]);
  const actionCounts = useMemo(() => ({
    create: batch.rows.filter(({ action }) => action === "CREATE").length,
    update: batch.rows.filter(({ action }) => action === "UPDATE").length,
    link: batch.rows.filter(({ action }) => action === "LINK_EXISTING").length,
    skip: batch.rows.filter(({ action }) => action === "SKIP").length,
  }), [batch.rows]);

  async function run(task: () => Promise<unknown>) {
    setBusy(true); setMessage("");
    try { await task(); router.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "操作失败"); }
    finally { setBusy(false); }
  }
  function openConfirmation() {
    setPreviewReviewed(false);
    setConfirmReason("");
    setConfirmKey(crypto.randomUUID());
    setConfirmOpen(true);
  }
  async function executeImport() {
    const reason = confirmReason.trim();
    if (!reason) return;
    setBusy(true); setMessage("");
    try {
      await api(`/api/v2/admin/imports/${batch.id}/confirm`, { confirm: true, expectedPreviewVersion: batch.previewVersion, reason }, { "Idempotency-Key": confirmKey });
      setConfirmOpen(false); router.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.code === "IMPORT_PREVIEW_STALE") {
        setConfirmOpen(false); setPreviewReviewed(false); setMessage("预览已被其他管理员修改，请刷新后重新核对。"); router.refresh();
      } else setMessage(error instanceof Error ? error.message : "操作失败");
    } finally { setBusy(false); }
  }

  return <div className="mt-6 space-y-6">
    {batch.status === "MAPPING_REQUIRED" && !batch.sheetName && <section className="rounded-3xl border bg-white p-6">
      <h2 className="text-xl font-semibold">选择工作表</h2>
      <div className="mt-4 flex gap-3"><select className="rounded-xl border p-2" value={selectedSheet} onChange={(event) => setSelectedSheet(event.target.value)}>{batch.sheets.map((sheet) => <option key={sheet}>{sheet}</option>)}</select><button disabled={busy || !selectedSheet} onClick={() => run(() => api(`/api/v2/admin/imports/${batch.id}/sheet`, { sheetName: selectedSheet }))} className="rounded-xl bg-slate-900 px-4 py-2 text-white disabled:opacity-40">读取表头</button></div>
    </section>}
    {batch.mappingColumns.length > 0 && ["MAPPING_REQUIRED", "PREVIEW_READY"].includes(batch.status) && <section className="rounded-3xl border bg-white p-6">
      <h2 className="text-xl font-semibold">字段映射</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-2">{mapping.map((column, index) => <label key={`${column.sourceColumn}-${column.sourceHeader}`} className="text-sm"><span className="text-slate-600">{column.sourceHeader || `第 ${column.sourceColumn} 列`}</span><select className="mt-1 w-full rounded-xl border p-2" value={column.targetField ?? ""} onChange={(event) => setMapping((items) => items.map((item, current) => current === index ? { ...item, targetField: event.target.value || null } : item))}><option value="">不导入</option>{fields[batch.importType].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>)}</div>
      <button disabled={busy || !batch.sheetName} onClick={() => run(() => api(`/api/v2/admin/imports/${batch.id}/mapping`, { sheetName: batch.sheetName, columns: mapping }))} className="mt-5 rounded-xl bg-slate-900 px-4 py-2 text-white disabled:opacity-40">重新生成预览</button>
    </section>}
    <section className="rounded-3xl border bg-white p-6">
      <div className="flex items-center justify-between"><div><h2 className="text-xl font-semibold">整批预览</h2><p className="mt-1 text-sm text-slate-500">手机号已脱敏；原始 Excel 不在列表中展开。</p></div>{["PREVIEW_READY", "SUCCEEDED", "FAILED"].includes(batch.status) && <a className="text-sm text-blue-700" href={`/api/v2/admin/imports/${batch.id}/result.xlsx`}>下载结果 XLSX</a>}</div>
      <div className="mt-4 flex flex-wrap gap-2">{[["ALL", "全部"], ["REVIEW", "需确认"], ["ERROR", "错误"], ["EXECUTABLE", "可执行"]].map(([value, label]) => <button key={value} type="button" onClick={() => setFilter(value as typeof filter)} className={`rounded-full border px-3 py-1 text-sm ${filter === value ? "bg-slate-900 text-white" : "bg-white"}`}>{label}</button>)}</div>
      <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-slate-500"><tr><th className="p-3">行</th><th className="p-3">本次 Excel 值</th><th className="p-3">动作</th><th className="p-3">问题 / 正式候选</th><th className="p-3">处理</th></tr></thead><tbody>{filteredRows.map((row) => {
        const candidates = rowCandidates(row);
        const governanceBlocked = row.issuesJson.some(({ code }) => ["PERSON_ARCHIVED_REQUIRES_GOVERNANCE", "ENTERPRISE_DISABLED_REQUIRES_GOVERNANCE", "ENTERPRISE_MATCHED_MERGED"].includes(code));
        return <tr key={row.id} className="border-t align-top"><td className="p-3">{row.rowNumber}</td><td className="p-3"><p className="font-medium">{row.normalizedJson.name ?? "—"}</p><p className="mt-1 max-w-md text-xs text-slate-500">{Object.entries(row.normalizedJson).filter(([key, value]) => key !== "name" && value).slice(0, 4).map(([key, value]) => `${key}: ${value}`).join("；")}</p></td><td className="p-3">{row.action}</td><td className="p-3"><p>{row.issuesJson.map((item) => item.message).join("；") || "—"}</p>{candidates.length > 0 && <div className="mt-2 space-y-2"><p className="text-xs font-medium text-slate-500">正式候选（请与本次 Excel 值核对）</p>{candidates.map((candidate) => <CandidateCard key={candidate.id} candidate={candidate} importType={batch.importType} />)}</div>}{[...new Set(row.issuesJson.flatMap(({ field }) => field ? [field] : []))].map((field) => <label key={field} className="mt-2 block text-xs text-slate-600">修正 {field}<input className="mt-1 w-full rounded-lg border p-2 text-sm" value={corrections[row.id]?.[field] ?? row.normalizedJson[field] ?? ""} onChange={(event) => setCorrections((all) => ({ ...all, [row.id]: { ...all[row.id], [field]: event.target.value } }))} /></label>)}</td><td className="p-3">{["NEEDS_REVIEW", "BLOCKED"].includes(row.resolutionStatus) ? <div className="flex flex-col items-start gap-2">{!governanceBlocked && <button disabled={busy} className="text-blue-700" onClick={() => run(() => api(`/api/v2/admin/imports/${batch.id}/rows/${row.id}/resolve`, { action: "CREATE", normalizedValues: corrections[row.id], reason: "管理员确认创建" }))}>创建新记录</button>}{!governanceBlocked && candidates.map((candidate) => <button key={candidate.id} disabled={busy} className="text-left text-blue-700" onClick={() => run(() => api(`/api/v2/admin/imports/${batch.id}/rows/${row.id}/resolve`, { action: "LINK_EXISTING", matchedEntityId: candidate.id, normalizedValues: corrections[row.id], reason: "管理员确认匹配" }))}>选择 {candidate.name}</button>)}<button disabled={busy} className="text-slate-500" onClick={() => run(() => api(`/api/v2/admin/imports/${batch.id}/rows/${row.id}/resolve`, { action: "SKIP", reason: "管理员确认跳过" }))}>跳过</button>{governanceBlocked && <p className="text-xs text-amber-700">请先在正式治理流程处理；本批只能跳过。</p>}</div> : "—"}</td></tr>;
      })}</tbody></table>{filteredRows.length === 0 && <p className="py-8 text-center text-slate-500">当前筛选没有导入行。</p>}</div>
    </section>
    {batch.status === "PREVIEW_READY" && <section className="rounded-3xl border bg-white p-6"><h2 className="text-xl font-semibold">正式确认</h2><p className="mt-2 text-sm text-slate-600">将创建 {actionCounts.create}、更新 {actionCounts.update}、关联 {actionCounts.link}、跳过 {actionCounts.skip}；整批原子写入，任何一行失败都会全部回滚。当前仍有 {reviewRows.length} 行待处理。</p><div className="mt-4 flex gap-3"><button disabled={busy || batch.blockingRowCount > 0} onClick={openConfirmation} className="rounded-xl bg-blue-600 px-5 py-2 text-white disabled:opacity-40">确认导入</button><button disabled={busy} onClick={() => run(() => api(`/api/v2/admin/imports/${batch.id}/cancel`, {}))} className="rounded-xl border px-5 py-2">取消批次</button></div></section>}
    {confirmOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="import-confirm-title"><div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-xl"><h2 id="import-confirm-title" className="text-xl font-semibold">确认执行正式导入</h2><dl className="mt-4 grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 p-4 text-sm"><div><dt className="text-slate-500">将创建</dt><dd className="font-semibold">{actionCounts.create}</dd></div><div><dt className="text-slate-500">将更新</dt><dd className="font-semibold">{actionCounts.update}</dd></div><div><dt className="text-slate-500">将关联</dt><dd className="font-semibold">{actionCounts.link}</dd></div><div><dt className="text-slate-500">将跳过</dt><dd className="font-semibold">{actionCounts.skip}</dd></div><div><dt className="text-slate-500">总行数</dt><dd className="font-semibold">{batch.rows.length}</dd></div><div><dt className="text-slate-500">Preview Version</dt><dd className="font-semibold">{batch.previewVersion}</dd></div></dl><p className="mt-4 text-sm leading-6 text-slate-600">本操作会整批写入正式数据；任意一行失败会整体回滚。成功后不提供任意一键恢复生产数据。</p><label className="mt-4 block text-sm"><span className="text-slate-700">正式导入原因</span><textarea required rows={3} value={confirmReason} onChange={(event) => setConfirmReason(event.target.value)} placeholder="说明本次正式导入的业务原因" className="mt-2 w-full rounded-xl border p-3" /></label><p className="mt-2 text-xs text-slate-500">执行前系统会先完成 PRE_IMPORT 云快照。</p><label className="mt-4 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={previewReviewed} onChange={(event) => setPreviewReviewed(event.target.checked)} /><span>我已核对预览结果与正式候选</span></label><div className="mt-6 flex justify-end gap-3"><button disabled={busy} onClick={() => { setConfirmOpen(false); setPreviewReviewed(false); setConfirmReason(""); }} className="rounded-xl border px-4 py-2">取消</button><button disabled={busy || !previewReviewed || !confirmReason.trim()} onClick={executeImport} className="rounded-xl bg-blue-600 px-4 py-2 text-white disabled:opacity-40">确认执行导入</button></div></div></div>}
    {message && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{message}</p>}
  </div>;
}
