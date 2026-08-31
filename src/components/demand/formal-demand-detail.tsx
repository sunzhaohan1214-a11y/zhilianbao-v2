import type { DemandOutcomeService, DemandRecommendationService, FormalDemandService } from "@/modules/demand";
import { FormalDemandActions } from "./formal-demand-actions";
import { FormalDemandParticipation } from "./formal-demand-participation";
import { DemandRecommendations } from "./demand-recommendations";
import { DemandLifecyclePanel } from "./demand-lifecycle-panel";
import type { DemandLifecycleService } from "@/modules/demand";
import { DemandOutcomePanel } from "./demand-outcome-panel";
import { detailNextStep } from "./demand-next-step";

type Detail = Awaited<ReturnType<FormalDemandService["detail"]>>;
type Timeline = Awaited<ReturnType<FormalDemandService["timeline"]>>;
type Recommendations = Awaited<ReturnType<DemandRecommendationService["getRecommendations"]>>;
type Lifecycle = Awaited<ReturnType<DemandLifecycleService["overview"]>>;
type Outcomes = Awaited<ReturnType<DemandOutcomeService["overview"]>>;

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

const provenanceLabel: Record<string, string> = {
  TOWNSHIP_DIRECT: "镇区直接录入",
  ADMIN_DIRECT: "管理员直接录入",
  DEMAND_LEAD: "需求线索转入",
  V1_MIGRATION: "历史数据迁移",
  MERGED_SOURCE: "合并来源",
};

const scanStatusLabel: Record<string, string> = {
  PENDING: "待安全检查",
  SCANNING: "安全检查中",
  PASSED: "安全检查通过",
  REJECTED: "文件已拒绝",
  FAILED: "安全检查失败",
};

function knownLabel(labels: Record<string, string>, value: string | null | undefined, fallback: string) {
  return value ? labels[value] ?? fallback : fallback;
}

function shanghai(value: Date | null): string {
  return value ? value.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "—";
}

export function FormalDemandDetail({
  demand,
  timeline,
  areas,
  recommendations,
  lifecycle,
  outcomes,
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
  outcomes: Outcomes | null;
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
  const nextStep = detailNextStep({ status: demand.status, canEdit, canSubmit, canReview, canDirectPublish, canClaim, lifecycle, outcomes });
  return (
    <section className="space-y-6">
      <header>
        <p className="text-sm font-semibold text-brand">{demand.businessNo}</p>
        <h1 className="mt-1 text-[28px] font-semibold tracking-tight text-foreground">{demand.title}</h1>
        <div className="mt-3 flex flex-wrap gap-2 text-sm"><span className="rounded-full bg-brand-soft px-3 py-1 text-brand">{knownLabel(statusLabel, demand.status, "状态待确认")}</span><span className="rounded-full bg-surface-secondary px-3 py-1">{knownLabel(typeLabel, demand.demandType, "其他需求")}</span><span className="rounded-full bg-surface-secondary px-3 py-1">{demand.urgency === "URGENT" ? "紧急" : "普通"}</span></div>
      </header>

      <article aria-labelledby="current-next-step" className="rounded-2xl border border-brand/20 bg-brand-soft p-5">
        <p className="text-xs font-semibold text-brand">当前下一步</p>
        <h2 className="sr-only" id="current-next-step">当前下一步</h2>
        <p className="mt-2 text-sm font-medium leading-6 text-foreground">{nextStep}</p>
      </article>

      {(demand.firstPublishedAt || canClaim) && <FormalDemandParticipation demand={demand} canClaim={canClaim} canApplyCollaboration={canApplyCollaboration} canManageCollaboration={canManageCollaboration} canAcceptInvitation={canAcceptInvitation} canLeaveCollaboration={canLeaveCollaboration} />}

      {recommendations && <DemandRecommendations demandId={demand.id} data={recommendations} />}

      {lifecycle && <DemandLifecyclePanel demandId={demand.id} overview={lifecycle} />}

      {outcomes && demand.status === "COMPLETED" && <DemandOutcomePanel demandId={demand.id} data={outcomes} />}

      {demand.latestReturnReason && <article className="rounded-2xl border border-danger/20 bg-danger-soft p-5"><p className="text-sm font-medium text-danger">最新退回原因</p><p className="mt-2 whitespace-pre-wrap text-foreground">{demand.latestReturnReason}</p></article>}

      <article className="rounded-2xl border border-separator bg-surface p-5 shadow-sm">
        <h2 className="text-lg font-semibold">核心信息</h2>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-muted">企业</dt><dd className="mt-1 font-medium">{demand.enterprise.name}</dd></div><div><dt className="text-muted">负责区域</dt><dd className="mt-1 font-medium">{demand.responsibleArea.name}</dd></div><div><dt className="text-muted">首次发布时间</dt><dd className="mt-1">{shanghai(demand.firstPublishedAt)}</dd></div><div><dt className="text-muted">最近提交审核</dt><dd className="mt-1">{shanghai(demand.submittedAt)}</dd></div></dl>
        <div className="mt-5 border-t border-separator pt-5"><p className="text-sm text-muted">企业原始需求描述</p><p className="mt-2 whitespace-pre-wrap leading-7">{demand.originalDescription}</p></div>
      </article>

      <article className="rounded-2xl border border-separator bg-surface p-5 shadow-sm">
        <h2 className="text-lg font-semibold">联系人快照</h2>
        {demand.contactSnapshot ? <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-muted">姓名 / 职务</dt><dd className="mt-1">{demand.contactSnapshot.contactName} {demand.contactSnapshot.contactPosition ?? ""}</dd></div><div><dt className="text-muted">联系电话</dt><dd className="mt-1"><a className="font-medium text-brand" href={`tel:${demand.contactSnapshot.contactPhone}`}>{demand.contactSnapshot.contactPhone}</a></dd></div></dl> : <p className="mt-3 text-sm text-muted">暂无快照。</p>}
      </article>

      <article className="rounded-2xl border border-separator bg-surface p-5 shadow-sm">
        <h2 className="text-lg font-semibold">来源与附件</h2>
        <ul className="mt-3 space-y-2 text-sm">{demand.provenances.map((source) => <li key={source.id}>{knownLabel(provenanceLabel, source.sourceType, "其他来源")}{source.demandLead ? ` · ${source.demandLead.businessNo}` : ""}</li>)}</ul>
        {demand.attachments.length === 0 ? <p className="mt-4 text-sm text-muted">无正式附件。</p> : <ul className="mt-4 divide-y divide-separator rounded-xl border border-separator">{demand.attachments.map((attachment) => <li key={`${attachment.id}-${attachment.relationType}`} className="p-3 text-sm"><span className="font-medium">{attachment.originalFilename}</span><span className="ml-2 text-muted">{attachment.relationType === "SOURCE_REFERENCE" ? "来源附件" : "正式附件"} · {knownLabel(scanStatusLabel, attachment.scanStatus, "检查状态待确认")}</span></li>)}</ul>}
      </article>

      {canReview && <article className="rounded-2xl border border-warning/20 bg-warning-soft p-5"><h2 className="text-lg font-semibold text-foreground">可能重复，请人工核实</h2>{demand.duplicateCandidates.length === 0 ? <p className="mt-2 text-sm text-warning">未发现同企业且标题包含关系的已发布候选。</p> : <ul className="mt-3 space-y-2">{demand.duplicateCandidates.map((candidate) => <li key={candidate.id} className="rounded-xl bg-surface p-3 text-sm"><span className="font-medium">{candidate.businessNo} · {candidate.title}</span><span className="ml-2 text-muted">{knownLabel(statusLabel, candidate.status, "状态待确认")}</span></li>)}</ul>}</article>}

      <article className="rounded-2xl border border-separator bg-surface p-5 shadow-sm">
        <h2 className="text-lg font-semibold">状态时间线</h2>
        {timeline.length === 0 ? <p className="mt-3 text-sm text-muted">暂无状态记录。</p> : <ol className="mt-4 space-y-4">{timeline.map((item) => <li key={item.id} className="border-l-2 border-brand/25 pl-4"><p className="font-medium">{knownLabel(actionLabel, item.actionCode, "系统记录")}</p><p className="mt-1 text-xs text-muted">{item.fromState ? knownLabel(statusLabel, item.fromState, "状态待确认") : "开始"} → {knownLabel(statusLabel, item.toState, "状态待确认")} · {shanghai(item.createdAt)} · {item.actorPerson?.name ?? "系统"}</p>{item.reason && <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{item.reason}</p>}</li>)}</ol>}
      </article>

      <FormalDemandActions demand={demand} areas={areas} canEdit={canEdit} canSubmit={canSubmit} canReview={canReview} canDirectPublish={canDirectPublish} />
    </section>
  );
}
