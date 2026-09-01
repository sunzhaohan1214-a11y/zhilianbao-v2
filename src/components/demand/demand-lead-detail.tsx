import Link from "next/link";
import { DemandLeadActions } from "./demand-lead-actions";

type LeadDetail = {
  id: string;
  businessNo: string;
  sourceType: string;
  status: string;
  rawEnterpriseName: string | null;
  rawContactName: string | null;
  rawContactPhone: string | null;
  rawTitle: string;
  rawContent: string;
  sourceChannel: string | null;
  sourceAt: Date;
  tripId: string | null;
  visitId: string | null;
  closeReason: string | null;
  responsibleArea: { id: string; name: string };
  enterprise: null | {
    id: string;
    name: string;
    status: string;
    contacts: { id: string; name: string; positionTitle: string | null; phone: string; status: string }[];
  };
  sourcePerson: { id: string; name: string } | null;
  mergedIntoLead: { id: string; businessNo: string; status: string } | null;
  convertedDemand: { id: string; businessNo: string; status: string } | null;
  supplements: {
    id: string;
    kind: string;
    note: string | null;
    verifiedTitle: string | null;
    verifiedDescription: string | null;
    demandType: string | null;
    urgency: string | null;
    createdAt: Date;
    createdByPerson: { id: string; name: string };
  }[];
  attachments: {
    id: string;
    originalFilename: string;
    actualSizeBytes: number | null;
    scanStatus: string;
  }[];
};

const statusLabel: Record<string, string> = {
  PENDING_TOWNSHIP_VERIFY: "待镇区核验",
  PENDING_ENTERPRISE_LINK: "待关联企业",
  NEED_MORE_INFO: "待补充",
  MERGED: "已合并",
  CLOSED: "已关闭",
  CONVERTED: "已转正式需求",
};

const sourceLabel: Record<string, string> = {
  ENTERPRISE_PUBLIC: "企业公开提交",
  MEMBER_VISIT: "团员走访来源",
  OTHER: "其他内部来源",
};

const scanStatusLabel: Record<string, string> = {
  PENDING: "待安全检查",
  SCANNING: "安全检查中",
  PASSED: "安全检查通过",
  REJECTED: "文件已拒绝",
  FAILED: "安全检查失败",
};

const enterpriseStatusLabel: Record<string, string> = {
  NORMAL: "正常",
  DISABLED: "已停用",
  MERGED: "已合并",
};

const supplementKindLabel: Record<string, string> = {
  INFO_ADDED: "补充信息",
  VERIFIED: "完成核验",
  LINKED_ENTERPRISE: "关联企业",
  STATUS_CHANGED: "状态更新",
};

export function DemandLeadDetail({ lead, admin }: { lead: LeadDetail; admin: boolean }) {
  return (
    <section className="space-y-6">
      <div>
        <p className="text-sm font-medium text-brand">{lead.businessNo} · {sourceLabel[lead.sourceType] ?? "其他来源"}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{lead.rawTitle}</h1>
        <div className="mt-3 flex flex-wrap gap-2 text-sm"><span className="rounded-full bg-brand-soft px-3 py-1 text-brand">{statusLabel[lead.status] ?? "状态待确认"}</span><span className="rounded-full bg-surface-secondary px-3 py-1 text-muted">{lead.responsibleArea.name}</span></div>
      </div>

      <article className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-5">
        <p className="text-xs font-semibold tracking-[0.16em] text-amber-700">原始提交 / 走访来源 · 永久快照</p>
        <h2 className="mt-3 text-lg font-semibold text-amber-950">{lead.rawEnterpriseName ?? lead.enterprise?.name ?? "未填写企业"}</h2>
        <p className="mt-2 whitespace-pre-wrap text-amber-950">{lead.rawContent}</p>
        <dl className="mt-4 grid gap-2 text-sm text-amber-900 sm:grid-cols-2">
          <div><dt className="text-amber-700">原始联系人</dt><dd>{lead.rawContactName ?? "—"} {lead.rawContactPhone ?? ""}</dd></div>
          <div><dt className="text-amber-700">来源时间</dt><dd>{lead.sourceAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</dd></div>
          <div><dt className="text-amber-700">来源人 / 渠道</dt><dd>{lead.sourcePerson?.name ?? lead.sourceChannel ?? "—"}</dd></div>
          <div><dt className="text-amber-700">行程 / 走访关联</dt><dd>{lead.tripId ? "已关联行程" : "未关联行程"} / {lead.visitId ? "已关联走访" : "未关联走访"}</dd></div>
        </dl>
        <div className="mt-4 border-t border-amber-200 pt-4"><p className="text-sm font-medium text-amber-900">原始附件</p>{lead.attachments.length === 0 ? <p className="mt-1 text-sm text-amber-700">无</p> : <ul className="mt-2 space-y-1 text-sm">{lead.attachments.map((attachment) => <li key={attachment.id}>{attachment.originalFilename} · {scanStatusLabel[attachment.scanStatus] ?? "检查状态待确认"}</li>)}</ul>}</div>
      </article>

      <article className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold">企业关联</h2>
        {lead.enterprise ? <p className="mt-2">{lead.enterprise.name} <span className="text-sm text-muted">（{enterpriseStatusLabel[lead.enterprise.status] ?? "状态待确认"}）</span></p> : <p className="mt-2 text-muted">尚未关联正式企业。</p>}
        {lead.mergedIntoLead && <p className="mt-2 text-sm">主线索：<Link className="text-blue-700" href={`${admin ? "/admin" : ""}/demand-leads/${lead.mergedIntoLead.id}`}>{lead.mergedIntoLead.businessNo}</Link></p>}
        {lead.convertedDemand && <p className="mt-2 text-sm">正式草稿：{lead.convertedDemand.businessNo} · 已转正式需求</p>}
        {lead.closeReason && <p className="mt-2 text-sm text-red-700">关闭原因：{lead.closeReason}</p>}
      </article>

      <article className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold">核验与补充时间线</h2>
        {lead.supplements.length === 0 ? <p className="mt-3 text-sm text-muted">尚无补充记录。</p> : <ol className="mt-4 space-y-4">{lead.supplements.map((item) => <li key={item.id} className="border-l-2 border-brand/25 pl-4"><p className="text-sm font-medium">{supplementKindLabel[item.kind] ?? "补充记录"} · {item.createdByPerson.name}</p><p className="mt-1 text-xs text-muted">{item.createdAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</p>{item.verifiedTitle && <p className="mt-2 font-medium">{item.verifiedTitle}</p>}{item.verifiedDescription && <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{item.verifiedDescription}</p>}{item.note && <p className="mt-1 text-sm text-muted">{item.note}</p>}</li>)}</ol>}
      </article>

      <DemandLeadActions leadId={lead.id} status={lead.status} enterpriseId={lead.enterprise?.id ?? null} contacts={(lead.enterprise?.contacts ?? []).map(({ id, name, positionTitle, phone }) => ({ id, name, positionTitle, phone }))} canRestore={admin} />
    </section>
  );
}
