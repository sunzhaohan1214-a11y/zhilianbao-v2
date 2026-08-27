import type { ReimbursementExpenseType, ReimbursementStatus } from "@/generated/prisma/client";

export const TRAVEL_EXPENSE_TYPES = [
  "TRAVEL_TRANSPORT_ACTUAL",
  "TRAVEL_TRANSPORT_SUBSIDY",
  "TRAVEL_MEAL_SUBSIDY",
  "TRAVEL_LODGING",
] as const satisfies readonly ReimbursementExpenseType[];

export const ACTIVITY_EXPENSE_TYPES = [
  "DINING",
  "VENUE",
  "MATERIAL_PRODUCTION",
  "SUPPLIES",
  "LODGING",
  "TRANSPORTATION",
  "OTHER",
] as const satisfies readonly ReimbursementExpenseType[];

export const SUBSIDY_EXPENSE_TYPES = [
  "TRAVEL_TRANSPORT_SUBSIDY",
  "TRAVEL_MEAL_SUBSIDY",
] as const satisfies readonly ReimbursementExpenseType[];

export const EDITABLE_STATUSES = ["DRAFT", "RETURNED"] as const satisfies readonly ReimbursementStatus[];

export const REIMBURSEMENT_STATUS_LABELS: Record<ReimbursementStatus, string> = {
  DRAFT: "草稿",
  PENDING_ONLINE_REVIEW: "待线上核验",
  RETURNED: "已退回",
  VERIFIED_PENDING_PAPER: "已核对（待交纸质材料）",
  PAPER_RECEIVED: "纸质材料已收",
  FINANCE_SUBMITTED: "已提交财务",
};
