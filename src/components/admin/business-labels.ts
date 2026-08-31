export const recordStatusLabel: Record<string, string> = { ACTIVE: "有效", INACTIVE: "已停用", NORMAL: "正常", DISABLED: "已停用", MERGED: "已合并" };
export const reviewStatusLabel: Record<string, string> = { PENDING_REVIEW: "待审核", APPROVED: "已通过", RETURNED: "已退回", CLOSED: "已关闭", CANCELED: "已取消" };
export const requestTypeLabel: Record<string, string> = { CREATE: "新增", CORRECTION: "纠错", RECOMMEND: "推荐", UPDATE: "变更" };
export const demandLeadStatusLabel: Record<string, string> = { PENDING_TOWNSHIP_VERIFY: "待镇区核验", PENDING_ENTERPRISE_LINK: "待关联企业", NEED_MORE_INFO: "待补充", MERGED: "已合并", CLOSED: "已关闭", CONVERTED: "已转正式需求" };
export const demandLeadNextStepLabel: Record<string, string> = { PENDING_TOWNSHIP_VERIFY: "核验信息，决定待补充、合并、关闭或转正式草稿", PENDING_ENTERPRISE_LINK: "关联已有企业后继续核验", NEED_MORE_INFO: "等待提交人补充信息", MERGED: "查看合并后的主线索", CLOSED: "查看关闭原因与历史", CONVERTED: "查看已创建的正式需求草稿" };
export const demandLeadSourceLabel: Record<string, string> = { ENTERPRISE_PUBLIC: "企业公开提交", MEMBER_VISIT: "团员走访", OTHER: "其他内部来源" };
export const announcementStatusLabel: Record<string, string> = { DRAFT: "草稿", PUBLISHED: "已发布", WITHDRAWN: "已撤回" };
export const policyPublicationStatusLabel: Record<string, string> = { DRAFT: "草稿", PUBLISHED: "已发布", WITHDRAWN: "已撤回" };
export const policyEffectStatusLabel: Record<string, string> = { CURRENT: "现行", REPLACED: "已被替代" };
export const systemHealthStatusLabel: Record<string, string> = { HEALTHY: "运行正常", DEGRADED: "需要关注" };
export const backupComplianceStatusLabel: Record<string, string> = { COMPLIANT: "符合要求", NON_COMPLIANT: "不符合要求", UNKNOWN: "状态待确认" };
export const serviceStatusLabel: Record<string, string> = { ACTIVE: "已启用", INACTIVE: "未启用", READY: "就绪", DEGRADED: "需要关注", FAILED: "运行失败", SUCCEEDED: "运行成功", PENDING: "等待处理", RUNNING: "运行中" };
export const batchStatusLabel: Record<string, string> = { PLANNED: "未开始", ACTIVE: "进行中", CLOSED: "已结束" };
export const membershipStatusLabel: Record<string, string> = { ACTIVE: "当前批次", ENDED: "已结束", WITHDRAWN: "已退出" };
export const talentScopeLabel: Record<string, string> = { DOMESTIC: "境内", OVERSEAS: "海外" };
export const talentRoundStatusLabel: Record<string, string> = { IN_PROGRESS: "对接中", COMPLETED: "已完成", WITHDRAWN: "已撤回", VOIDED: "已作废" };
export const changeTypeLabel: Record<string, string> = { CREATE: "创建", FORMAL_CORRECTION: "正式纠错", CHANGE_REQUEST_APPROVED: "申请审核通过", DISABLE: "停用", RESTORE: "恢复", MERGE: "合并", COORDINATE: "坐标维护" };

export function businessLabel(labels: Record<string, string>, value: string | null | undefined, fallback = "状态待确认") {
  return value ? labels[value] ?? fallback : fallback;
}
