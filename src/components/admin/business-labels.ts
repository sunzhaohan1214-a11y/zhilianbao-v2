export const recordStatusLabel: Record<string, string> = { ACTIVE: "有效", INACTIVE: "已停用", NORMAL: "正常", DISABLED: "已停用", MERGED: "已合并" };
export const reviewStatusLabel: Record<string, string> = { PENDING_REVIEW: "待审核", APPROVED: "已通过", RETURNED: "已退回", CLOSED: "已关闭", CANCELED: "已取消" };
export const requestTypeLabel: Record<string, string> = { CREATE: "新增", CORRECTION: "纠错", RECOMMEND: "推荐", UPDATE: "变更" };
export const demandLeadStatusLabel: Record<string, string> = { PENDING_TOWNSHIP_VERIFY: "待镇区核验", PENDING_ENTERPRISE_LINK: "待关联企业", NEED_MORE_INFO: "待补充", MERGED: "已合并", CLOSED: "已关闭", CONVERTED: "已转正式需求" };
export const demandLeadSourceLabel: Record<string, string> = { ENTERPRISE_PUBLIC: "企业公开提交", MEMBER_VISIT: "团员走访", OTHER: "其他内部来源" };
export const announcementStatusLabel: Record<string, string> = { DRAFT: "草稿", PUBLISHED: "已发布", WITHDRAWN: "已撤回" };
export const batchStatusLabel: Record<string, string> = { PLANNED: "未开始", ACTIVE: "进行中", CLOSED: "已结束" };
export const membershipStatusLabel: Record<string, string> = { ACTIVE: "当前批次", ENDED: "已结束", WITHDRAWN: "已退出" };
export const talentScopeLabel: Record<string, string> = { DOMESTIC: "境内", OVERSEAS: "海外" };
export const talentRoundStatusLabel: Record<string, string> = { IN_PROGRESS: "对接中", COMPLETED: "已完成", WITHDRAWN: "已撤回", VOIDED: "已作废" };
export const changeTypeLabel: Record<string, string> = { CREATE: "创建", FORMAL_CORRECTION: "正式纠错", CHANGE_REQUEST_APPROVED: "申请审核通过", DISABLE: "停用", RESTORE: "恢复", MERGE: "合并", COORDINATE: "坐标维护" };

export function businessLabel(labels: Record<string, string>, value: string | null | undefined, fallback = "状态待确认") {
  return value ? labels[value] ?? fallback : fallback;
}
