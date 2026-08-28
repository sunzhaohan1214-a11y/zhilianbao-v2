import type { DemandUrgency, HelpUrgency } from "@/generated/prisma/client";
import type { HomeTodo } from "./types";

export type HomeTodoCandidate = Omit<HomeTodo, "priority"> & {
  demandUrgency?: DemandUrgency;
  helpUrgency?: HelpUrgency;
};

export const HOME_TODO_LABELS: Readonly<Record<string, string>> = {
  ANNOUNCEMENT_CONFIRM: "确认重要公告",
  DEMAND_REVIEW: "审核正式需求",
  DEMAND_REVISE: "修改退回需求",
  COLLABORATION_REVIEW: "处理协同申请",
  COLLABORATION_INVITE_RESPONSE: "回应协同邀请",
  DEMAND_UPDATE_STALE: "更新久未进展的需求",
  DEMAND_CONTINUE: "继续跟进需求",
  DEMAND_CLOSE_REVIEW: "审核需求办结",
  DEMAND_OWNER_EXIT_REVIEW: "审核负责人退出",
  DEMAND_ALUMNI_RESPONSE: "回应需求协助邀请",
  OUTCOME_FILL: "填报需求成效",
  OUTCOME_REVIEW: "审核需求成效",
  OUTCOME_REVISE: "修改退回成效",
  HELP_CLAIM: "接手办事求助",
  HELP_PROCESS: "处理办事求助",
  TRIP_RESULT: "补充行程结果",
  REIMBURSEMENT_REVIEW: "核对报销材料",
  REIMBURSEMENT_REVISE: "修改退回报销",
  REIMBURSEMENT_SUBMIT_FINANCE: "提交纸质报销材料",
};

export function resolveHomeTodoPriority(candidate: HomeTodoCandidate): HomeTodo {
  const priority = candidate.demandUrgency === "URGENT" || candidate.helpUrgency === "URGENT"
    ? "HIGH" as const
    : "NORMAL" as const;
  return {
    id: candidate.id,
    type: candidate.type,
    label: candidate.label,
    module: candidate.module,
    actionUrl: candidate.actionUrl,
    dueAt: candidate.dueAt,
    createdAt: candidate.createdAt,
    priority,
  };
}

export function sortHomeTodos(items: readonly HomeTodo[]): HomeTodo[] {
  return [...items].sort((left, right) => {
    const priority = Number(right.priority === "HIGH") - Number(left.priority === "HIGH");
    if (priority !== 0) return priority;
    const leftSortAt = left.dueAt ?? left.createdAt;
    const rightSortAt = right.dueAt ?? right.createdAt;
    const due = leftSortAt.getTime() - rightSortAt.getTime();
    if (due !== 0) return due;
    const created = left.createdAt.getTime() - right.createdAt.getTime();
    return created !== 0 ? created : left.id.localeCompare(right.id);
  });
}
