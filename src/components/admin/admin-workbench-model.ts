export const adminWorkbenchEntries = [
  { capability: "demand.review", title: "需求发布审核", description: "审核待发布需求，决定通过发布或退回修改。", href: "/admin/demands?status=PENDING_REVIEW" },
  { capability: "demand.close.review", title: "需求办结审核", description: "记录镇区核验结果，决定办结或退回继续跟进。", href: "/admin/demands?status=PENDING_CLOSE_REVIEW" },
  { capability: "demand.owner.exit_review", title: "主责退出审核", description: "处理主责退出申请，不代替超级管理员转交主责。", href: "/admin/demands?status=IN_PROGRESS" },
  { capability: "demand.owner.transfer", title: "主责转交", description: "在线下确认后预览影响并执行主责转交。", href: "/admin/demands?status=IN_PROGRESS" },
  { capability: "demand.outcome.review", title: "需求成效审核", description: "审核镇区提交的成效记录与跟踪计划。", href: "/admin/demands?status=COMPLETED" },
  { capability: "demand.lead.view", title: "线索核验", description: "核验来源信息、关联企业并转为正式草稿。", href: "/admin/demand-leads" },
  { capability: "help.assign", title: "办事求助", description: "分派、改派并跟进当前求助事项。", href: "/admin/help-requests" },
  { capability: "enterprise.edit_formal", title: "企业申请审核", description: "核对企业新增与信息变更申请。", href: "/admin/enterprise-change-requests" },
  { capability: "talent.review", title: "人才申请审核", description: "核对人才推荐、纠错与对接记录。", href: "/admin/talent-change-requests" },
  { capability: "import.execute", title: "数据导入处理", description: "查看阻塞行、完成消歧并确认整批导入。", href: "/admin/imports" },
] as const;

export function visibleAdminWorkbenchEntries(capabilities: ReadonlySet<string>) {
  return adminWorkbenchEntries.filter((item) => capabilities.has(item.capability));
}
