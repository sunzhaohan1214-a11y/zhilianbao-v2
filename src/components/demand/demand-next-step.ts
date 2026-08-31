type LifecyclePermissions = {
  canAddProgress?: boolean;
  canSubmitClose?: boolean;
  canReviewClose?: boolean;
  canReviewOwnerExit?: boolean;
  canTransferOwner?: boolean;
};

type OutcomeOverview = {
  permissions?: { canCreatePlan?: boolean; canCreateRound?: boolean };
  rounds?: Array<{ permissions?: { canReview?: boolean } }>;
};

export const demandListNextStep: Record<string, string> = {
  DRAFT: "等待录入人员完善草稿并提交审核",
  PENDING_REVIEW: "等待管理员审核",
  RETURNED: "按退回意见修改后重新提交",
  PENDING_CLAIM: "等待符合条件的在任团员认领",
  IN_PROGRESS: "主责与协同人员持续跟进",
  PENDING_CLOSE_REVIEW: "等待管理员完成办结审核",
  COMPLETED: "查看成效跟踪与历史",
  CANCELED: "查看取消原因与历史",
  MERGED: "查看合并后的主需求",
};

export function listNextStep(status: string) {
  return demandListNextStep[status] ?? "打开详情确认当前下一步";
}

export function detailNextStep(input: {
  status: string;
  canEdit: boolean;
  canSubmit: boolean;
  canReview: boolean;
  canDirectPublish: boolean;
  canClaim: boolean;
  lifecycle?: { permissions?: LifecyclePermissions } | null;
  outcomes?: OutcomeOverview | null;
}) {
  const lifecycle = input.lifecycle?.permissions;
  switch (input.status) {
    case "DRAFT":
      if (input.canDirectPublish) return "核对企业、联系人和附件后，可直接发布这条管理员代录需求。";
      if (input.canEdit && input.canSubmit) return "完善草稿，确认无误后提交管理员审核。";
      if (input.canEdit) return "继续完善草稿；提交审核需由有权限的录入人员完成。";
      if (input.canSubmit) return "提交管理员审核。";
      return "等待有权限的录入人员完善草稿并提交审核。";
    case "RETURNED":
      if (input.canEdit && input.canSubmit) return "按退回意见修改，确认无误后重新提交审核。";
      if (input.canEdit) return "按退回意见继续修改；重新提交需由有权限的录入人员完成。";
      if (input.canSubmit) return "确认退回问题已修正后，重新提交审核。";
      return "等待负责录入人员按退回意见修改并重新提交。";
    case "PENDING_REVIEW":
      return input.canReview
        ? "核对核心字段与重复候选，决定通过发布或退回修改。"
        : "等待管理员审核；审核完成后状态会自动更新。";
    case "PENDING_CLAIM":
      return input.canClaim
        ? "查看完整信息后，可选择“我要对接”成为主责。"
        : "等待符合条件的在任团员认领对接。";
    case "IN_PROGRESS":
      if (lifecycle?.canReviewOwnerExit) return "先处理主责退出审核，再按审核结果继续跟进。";
      if (lifecycle?.canAddProgress && lifecycle.canSubmitClose) return "持续更新进展；事项完成后提交办结申请。";
      if (lifecycle?.canAddProgress) return "补充当前进展、下一步和预计时间。";
      if (lifecycle?.canSubmitClose) return "确认事项完成后提交办结申请。";
      if (lifecycle?.canTransferOwner) return "仅在线下确认后，预览影响并执行主责转交。";
      return "等待主责或负责镇区继续跟进；你可以查看最新进展。";
    case "PENDING_CLOSE_REVIEW":
      return lifecycle?.canReviewClose
        ? "记录镇区核验结果，并完成办结审核与成效计划选择。"
        : "等待管理员完成办结审核；退回后将继续跟进。";
    case "COMPLETED":
      if (input.outcomes?.permissions?.canCreatePlan) return "补建成效跟踪计划，明确是否继续跟踪。";
      if (input.outcomes?.permissions?.canCreateRound) return "填写本轮新增成效并提交审核。";
      if (input.outcomes?.rounds?.some((round) => round.permissions?.canReview)) return "审核待提交的成效记录。";
      return "查看已审核的成效与完整办理历史。";
    case "CANCELED":
      return "流程已取消；可查看取消原因和历史记录。";
    case "MERGED":
      return "当前记录已合并；请查看主需求继续了解进展。";
    default:
      return "当前状态待确认，请刷新后查看或等待有权限人员处理。";
  }
}
