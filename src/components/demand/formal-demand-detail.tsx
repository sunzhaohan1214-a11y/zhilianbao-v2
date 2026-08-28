import type { DemandRecommendationService, FormalDemandService } from "@/modules/demand";
import { FormalDemandActions } from "./formal-demand-actions";
import { FormalDemandParticipation } from "./formal-demand-participation";
import { DemandRecommendations } from "./demand-recommendations";
import { DemandLifecyclePanel } from "./demand-lifecycle-panel";
import type { DemandLifecycleService } from "@/modules/demand";

type Detail = Awaited<ReturnType<FormalDemandService["detail"]>>;
type Timeline = Awaited<ReturnType<FormalDemandService["timeline"]>>;
type Recommendations = Awaited<ReturnType<DemandRecommendationService["getRecommendations"]>>;
type Lifecycle = Awaited<ReturnType<DemandLifecycleService["overview"]>>;

const statusLabel: Record<string, string> = {
  DRAFT: "草稿",
  PENDING_REVIEW: "待审核",
  RETURNED: "退回修改",
  PENDING_CLAIM: "待对接",
  IN_PROGRESS: "对接中",
  PENDING_CLOSE_REVIEW: "待办结审核",
  COMPLETED: "已办结",
  CANCELED: "已取消",
  MERGED: "已合并",
};

const typeLabel: Record<string, string> = {
  TECHNICAL: "技术攻关",
  TALENT: "人才合作",
  PROJECT: "项目落地",
  OTHER: "其他需求",
};

const actionLabel: Record<string, string> = {
  DEMAND_DRAFT_CREATED_FROM_LEAD: "从需求线索创建草稿",
  DEMAND_DIRECT_DRAFT_CREATED: "直接创建正式需求草稿",
  DEMAND_SUBMITTED_FOR_REVIEW: "提交审核",
  DEMAND_REVIEW_RETURNED: "管理员退回",
  DEMAND_REVIEW_APPROVED_AND_PUBLISHED: "审核通过并发布",
  DEMAND_ADMIN_DIRECT_PUBLISHED: "管理员代录直接发布",
  DEMAND_CLAIMED: "团员认领并开始跟进",
};

function shanghai(value: Date | null): string {
  return value ? value.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "—";
}

export function FormalDemandDetail({
  demand,
  timeline,
  areas,
  recommendations,
  lifecycle,
  canEdit,
  canSubmit,
  canReview,
  canDirectPublish,
  canClaim,
  canApplyCollaboration,
  canManageCollaboration,
  canAcceptInvitation,
  canLeaveCollaboration,
}: {
  demand: Detail;
  timeline: Timeline;
  areas: { id: string; name: string }[];
  recommendations: Recommendations | null;
  lifecycle: Lifecycle | null;
  canEdit: boolean;
  canSubmit: boolean;
  canReview: boolean;
  canDirectPublish: boolean;
  canClaim: boolean;
  canApplyCollaboration: boolean;
  canManageCollaboration: boolean;
  canAcceptInvitation: boolean;
  canLeaveCollaboration: boolean;
}) {
  return (
    <section className="space-y-6">
      <header>
        <p className="text-sm font-medium text-blue-600">{demand.businessNo}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{demand.title}</h1>
        <div className="mt-3 flex flex-wrap gap-2 text-sm"><span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700">{statusLabel[demand.status] ?? demand.status}</span><span className="rounded-full bg-slate-100 px-3 py-1">{typeLabel[demand.demandType] ?? demand.demandType}</span><span className="rounded-full bg-slate-100 px-3 py-1">{demand.urgency === "URGENT" ? "紧急" : "普通"}</span></div>
      </header>

      {(demand.firstPublishedAt || canClaim) && <FormalDemandParticipation demand={demand} canClaim={canClaim} canApplyCollaboration={canApplyCollaboration} canManageCollaboration={canManageCollaboration} canAcceptInvitation={canAcceptInvitation} canLeaveCollaboration={canLeaveCollaboration} />}

      {recommendations && <DemandRecommendations demandId={demand.id} data={recommendations} />}

      {lifecycle && <DemandLifecyclePanel demandId={demand.id} overview={lifecycle} />}

      {demand.latestReturnReason && <article className="rounded-2xl border border-red-200 bg-red-50 p-5"><p className="text-sm font-medium text-red-700">最新退回原因</p><p className="mt-2 whitespace-pre-wrap text-red-950">{demand.latestReturnReason}</p></article>}

      <article className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold">核心信息</h2>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-slate-500">Enterprise</dt><dd className="mt-1 font-medium">{demand.enterprise.name}</dd></div><div><dt className="text-slate-500">负责区域</dt><dd className="mt-1 font-medium">{demand.responsibleArea.name}</dd></div><div><dt className="text-slate-500">首次发布时间</dt><dd className="mt-1">{shanghai(demand.firstPublishedAt)}</dd></div><div><dt className="text-slate-500">最近提交审核</dt><dd className="mt-1">{shanghai(demand.submittedAt)}</dd></div></dl>
        <div className="mt-5 border-t pt-5"><p className="text-sm text-slate-500">企业原始需求描述</p><p className="mt-2 whitespace-pre-wrap leading-7">{demand.originalDescription}</p></div>
      </article>

      <article className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold">联系人快照</h2>
        {demand.contactSnapshot ? <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-slate-500">姓名 / 职务</dt><dd className="mt-1">{demand.contactSnapshot.contactName} {demand.contactSnapshot.contactPosition ?? ""}</dd></div><div><dt className="text-slate-500">联系电话</dt><dd className="mt-1"><a className="text-blue-700" href={`tel:${demand.contactSnapshot.contactPhone}`}>{demand.contactSnapshot.contactPhone}</a></dd></div></dl> : <p className="mt-3 text-sm text-slate-500">暂无快照。</p>}
      </article>

      <article className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold">来源与附件</h2>
        <ul className="mt-3 space-y-2 text-sm">{demand.provenances.map((source) => <li key={source.id}>{source.sourceType}{source.demandLead ? ` · ${source.demandLead.businessNo}` : ""}</li>)}</ul>
        {demand.attachments.length === 0 ? <p className="mt-4 text-sm text-slate-500">无正式附件。</p> : <ul className="mt-4 divide-y rounded-xl border">{demand.attachments.map((attachment) => <li key={`${attachment.id}-${attachment.relationType}`} className="p-3 text-sm"><span className="font-medium">{attachment.originalFilename}</span><span className="ml-2 text-slate-500">{attachment.relationType === "SOURCE_REFERENCE" ? "来源附件" : "正式附件"} · {attachment.scanStatus}</span></li>)}</ul>}
      </article>

      {canReview && <article className="rounded-2xl border border-amber-200 bg-amber-50 p-5"><h2 className="text-lg font-semibold text-amber-950">可能重复，请人工核实</h2>{demand.duplicateCandidates.length === 0 ? <p className="mt-2 text-sm text-amber-800">未发现同企业且标题包含关系的已发布候选。</p> : <ul className="mt-3 space-y-2">{demand.duplicateCandidates.map((candidate) => <li key={candidate.id} className="rounded-xl bg-white/80 p-3 text-sm"><span className="font-medium">{candidate.businessNo} · {candidate.title}</span><span className="ml-2 text-slate-500">{statusLabel[candidate.status] ?? candidate.status}</span></li>)}</ul>}</article>}

      <article className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold">状态时间线</h2>
        {timeline.length === 0 ? <p className="mt-3 text-sm text-slate-500">暂无状态记录。</p> : <ol className="mt-4 space-y-4">{timeline.map((item) => <li key={item.id} className="border-l-2 border-blue-200 pl-4"><p className="font-medium">{actionLabel[item.actionCode] ?? item.actionCode}</p><p className="mt-1 text-xs text-slate-500">{statusLabel[item.fromState ?? ""] ?? "开始"} → {statusLabel[item.toState] ?? item.toState} · {shanghai(item.createdAt)} · {item.actorPerson?.name ?? "系统"}</p>{item.reason && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{item.reason}</p>}</li>)}</ol>}
      </article>

      <FormalDemandActions demand={demand} areas={areas} canEdit={canEdit} canSubmit={canSubmit} canReview={canReview} canDirectPublish={canDirectPublish} />
    </section>
  );
}
