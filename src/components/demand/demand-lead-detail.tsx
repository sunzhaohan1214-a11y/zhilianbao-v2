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

export function DemandLeadDetail({ lead, admin }: { lead: LeadDetail; admin: boolean }) {
  return (
    <section className="space-y-6">
      <div>
        <p className="text-sm font-medium text-blue-600">{lead.businessNo} · {sourceLabel[lead.sourceType] ?? lead.sourceType}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{lead.rawTitle}</h1>
        <div className="mt-3 flex flex-wrap gap-2 text-sm"><span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700">{statusLabel[lead.status] ?? lead.status}</span><span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">{lead.responsibleArea.name}</span></div>
      </div>

      <article className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-5">
        <p className="text-xs font-semibold tracking-[0.16em] text-amber-700">原始提交 / 走访来源 · 永久快照</p>
        <h2 className="mt-3 text-lg font-semibold text-amber-950">{lead.rawEnterpriseName ?? lead.enterprise?.name ?? "未填写企业"}</h2>
        <p className="mt-2 whitespace-pre-wrap text-amber-950">{lead.rawContent}</p>
        <dl className="mt-4 grid gap-2 text-sm text-amber-900 sm:grid-cols-2">
          <div><dt className="text-amber-700">原始联系人</dt><dd>{lead.rawContactName ?? "—"} {lead.rawContactPhone ?? ""}</dd></div>
          <div><dt className="text-amber-700">来源时间</dt><dd>{lead.sourceAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</dd></div>
          <div><dt className="text-amber-700">来源人 / 渠道</dt><dd>{lead.sourcePerson?.name ?? lead.sourceChannel ?? "—"}</dd></div>
          <div><dt className="text-amber-700">行程 / 走访预留</dt><dd>{lead.tripId ?? "—"} / {lead.visitId ?? "—"}</dd></div>
        </dl>
        <div className="mt-4 border-t border-amber-200 pt-4"><p className="text-sm font-medium text-amber-900">原始附件</p>{lead.attachments.length === 0 ? <p className="mt-1 text-sm text-amber-700">无</p> : <ul className="mt-2 space-y-1 text-sm">{lead.attachments.map((attachment) => <li key={attachment.id}>{attachment.originalFilename} · {attachment.scanStatus}</li>)}</ul>}</div>
      </article>

      <article className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold">企业关联</h2>
        {lead.enterprise ? <p className="mt-2">{lead.enterprise.name} <span className="text-sm text-slate-500">({lead.enterprise.status})</span></p> : <p className="mt-2 text-slate-500">尚未关联正式企业。</p>}
        {lead.mergedIntoLead && <p className="mt-2 text-sm">主线索：<Link className="text-blue-700" href={`${admin ? "/admin" : ""}/demand-leads/${lead.mergedIntoLead.id}`}>{lead.mergedIntoLead.businessNo}</Link></p>}
        {lead.convertedDemand && <p className="mt-2 text-sm">正式草稿：{lead.convertedDemand.businessNo} · {lead.convertedDemand.status}</p>}
        {lead.closeReason && <p className="mt-2 text-sm text-red-700">关闭原因：{lead.closeReason}</p>}
      </article>

      <article className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold">核验与补充时间线</h2>
        {lead.supplements.length === 0 ? <p className="mt-3 text-sm text-slate-500">尚无补充记录。</p> : <ol className="mt-4 space-y-4">{lead.supplements.map((item) => <li key={item.id} className="border-l-2 border-blue-200 pl-4"><p className="text-sm font-medium">{item.kind} · {item.createdByPerson.name}</p><p className="mt-1 text-xs text-slate-500">{item.createdAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</p>{item.verifiedTitle && <p className="mt-2 font-medium">{item.verifiedTitle}</p>}{item.verifiedDescription && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{item.verifiedDescription}</p>}{item.note && <p className="mt-1 text-sm text-slate-600">{item.note}</p>}</li>)}</ol>}
      </article>

      <DemandLeadActions leadId={lead.id} status={lead.status} enterpriseId={lead.enterprise?.id ?? null} contacts={(lead.enterprise?.contacts ?? []).map(({ id, name, positionTitle, phone }) => ({ id, name, positionTitle, phone }))} canRestore={admin} />
    </section>
  );
}
