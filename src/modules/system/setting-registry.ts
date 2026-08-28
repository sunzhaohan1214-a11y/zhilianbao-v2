import { z } from "zod";

type SettingDefinition<T> = {
  type: "STRING" | "INTEGER";
  default: T | null;
  editable: boolean;
  riskLevel: "NORMAL" | "HIGH";
  schema: z.ZodType<T>;
  description: string;
  runtimeStatus?: "WIRED" | "NOT_WIRED";
};

export const SYSTEM_SETTING_REGISTRY = {
  "system.admin_contact_phone": { type: "STRING", default: null, editable: true, riskLevel: "NORMAL", schema: z.string().trim().min(5).max(30), description: "登录页展示的管理员联系电话；未初始化时继续使用部署环境配置。" },
  "demand.claim_cycle_natural_days": { type: "INTEGER", default: 30, editable: true, riskLevel: "HIGH", schema: z.number().int().min(1).max(366), description: "正式需求完整认领周期（自然日）。" },
  "demand.review_sla_normal_workdays": { type: "INTEGER", default: 3, editable: false, runtimeStatus: "NOT_WIRED", riskLevel: "HIGH", schema: z.number().int().min(1).max(30), description: "普通需求审核时限（工作日）；当前版本尚未接入 deadline 快照，暂不可修改。" },
  "demand.review_sla_urgent_workdays": { type: "INTEGER", default: 1, editable: false, runtimeStatus: "NOT_WIRED", riskLevel: "HIGH", schema: z.number().int().min(1).max(30), description: "紧急需求审核时限（工作日）；当前版本尚未接入 deadline 快照，暂不可修改。" },
  "system.business_timezone": { type: "STRING", default: "Asia/Shanghai", editable: false, riskLevel: "HIGH", schema: z.literal("Asia/Shanghai"), description: "全系统固定业务时区，只读。" },
} as const satisfies Record<string, SettingDefinition<unknown>>;

export type SystemSettingKey = keyof typeof SYSTEM_SETTING_REGISTRY;
export function isSystemSettingKey(value: string): value is SystemSettingKey { return Object.hasOwn(SYSTEM_SETTING_REGISTRY, value); }
