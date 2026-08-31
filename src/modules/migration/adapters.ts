import { matchEnterprise, matchPerson, matchPolicy, matchTalent, type EnterpriseMatchCandidate, type PersonMatchCandidate, type PolicyMatchCandidate, type TalentMatchCandidate } from "@/modules/entity-matching";
import type { EntityMatchResult } from "@/modules/entity-matching";
import type { LegacyRecord, MigrationPreviewIssue, MigrationRecordOutcome } from "./types";

export type MigrationMatchContext = {
  people?: readonly PersonMatchCandidate[];
  enterprises?: readonly EnterpriseMatchCandidate[];
  talents?: readonly TalentMatchCandidate[];
  policies?: readonly PolicyMatchCandidate[];
};

export const DEMAND_STATUS_MAP = { "待对接": "PENDING_CLAIM", "已对接": "IN_PROGRESS", "已解决": "COMPLETED" } as const;
export const DEMAND_TYPE_MAP: Record<string, "TECHNICAL" | "TALENT" | "PROJECT" | "OTHER"> = { "技术需求": "TECHNICAL", "人才合作": "TALENT", "落地需求": "PROJECT" };
export const REIMBURSEMENT_STATUS_MAP = { "审核中": "PENDING_ONLINE_REVIEW", "已退回": "RETURNED", "已通过": "LEGACY_VERIFIED_TERMINAL" } as const;
const HELP_CATEGORIES = new Set(["政策咨询", "项目申报", "人才服务", "企业服务", "餐饮", "其他"]);
const HIGH_PRIVILEGE = new Set(["SUPER_ADMIN", "ADMIN", "MINISTER", "GROUP_LEADER", "reimbursement.manage", "ai.service_manage"]);

function issue(record: LegacyRecord, code: string, severity: MigrationPreviewIssue["severity"], message: string, field?: string, candidates?: string[]): MigrationPreviewIssue {
  return { sourceEntity: record.entityType, sourceId: record.sourceId, code, severity, field, message, candidates, sourceSnapshot: record.payload };
}

function matchOutcome(record: LegacyRecord, targetEntity: string, match: EntityMatchResult): MigrationRecordOutcome {
  const issues = match.issues.map((item) => issue(record, item.code, item.severity === "ERROR" ? "BLOCKER" : item.severity, item.message, item.field, item.candidateIds));
  if (match.kind === "INVALID") return { classification: "FAILED", targetEntity, match, issues };
  if (match.kind === "REVIEW") return { classification: "REVIEW", targetEntity, match, issues };
  return { classification: match.kind === "EXACT" ? "MERGED" : "SUCCESS", targetEntity, targetId: match.matchedEntityId, match, issues };
}

export function analyzeLegacyRecord(record: LegacyRecord, context: MigrationMatchContext = {}): MigrationRecordOutcome {
  const value = record.payload;
  switch (record.entityType) {
    case "ORGANIZATION":
      return { classification: "SUCCESS", targetEntity: "ORGANIZATION", issues: [] };
    case "PERSON": {
      const match = matchPerson({ name: String(value.name), phone: value.phone ? String(value.phone) : undefined }, context.people ?? []);
      const outcome = matchOutcome(record, "PERSON", match);
      if (value.memberKind === "FUTURE_MEMBER_CANDIDATE") {
        outcome.classification = "REVIEW";
        outcome.issues.push(issue(record, "FUTURE_BATCH_NOT_ACTIVE", "REVIEW", "未来批次候选人员不自动创建批次关系或账号", "memberKind"));
      } else if (value.memberKind === "CURRENT" && value.currentEmploymentConfirmed !== true) {
        outcome.classification = "REVIEW";
        outcome.issues.push(issue(record, "CURRENT_EMPLOYMENT_CONFIRMATION_REQUIRED", "REVIEW", "当前批次候选人员未证明在岗，不自动创建批次关系或账号", "currentEmploymentConfirmed"));
      }
      if (outcome.classification === "SUCCESS" && value.accountEligible === true && (value.memberKind === "ALUMNI_HISTORICAL" || value.currentEmploymentConfirmed !== true)) {
        outcome.classification = "REVIEW";
        outcome.issues.push(issue(record, "PERSON_ACCOUNT_ELIGIBILITY_UNCONFIRMED", "REVIEW", "历史往届或未确认当前在岗人员不得自动开户", "accountEligible"));
      }
      return outcome;
    }
    case "ENTERPRISE": {
      const area = String(value.responsibleAreaName);
      const candidates = (context.enterprises ?? []).filter((candidate) => candidate.responsibleAreaId === area || candidate.responsibleAreaId === String(value.responsibleAreaId ?? ""));
      const outcome = matchOutcome(record, "ENTERPRISE", matchEnterprise({ name: String(value.name), responsibleAreaId: area, creditCode: value.creditCode ? String(value.creditCode) : undefined }, candidates));
      if (!value.creditCode && outcome.classification === "SUCCESS") {
        outcome.classification = "REVIEW";
        outcome.issues.push(issue(record, "ENTERPRISE_NO_CODE_REQUIRES_REVIEW", "REVIEW", "无信用代码企业只能作为人工候选，不能自动创建或合并", "creditCode"));
      }
      if ((value.contactName || value.contactPhone) && value.primaryContactConfirmed !== true) outcome.issues.push(issue(record, "ENTERPRISE_PRIMARY_CONTACT_UNCONFIRMED", "REVIEW", "V1 未确认主要联系人，不自动设置 primary", "primaryContactConfirmed"));
      if (value.latitude !== undefined || value.longitude !== undefined) outcome.issues.push(issue(record, "ENTERPRISE_COORDINATE_SEPARATE_GOVERNANCE", "WARNING", "V1 坐标只作展示候选，不用于修改正式属地", "latitude"));
      if (Array.isArray(value.legacyTagNames) && value.legacyTagNames.length > 0) outcome.issues.push(issue(record, "ENTERPRISE_TAG_MAPPING_REQUIRED", "WARNING", "V1 标签需映射到受治理的 V2 标签后才能生效", "legacyTagNames"));
      return outcome;
    }
    case "TALENT": {
      const outcome = matchOutcome(record, "TALENT", matchTalent({ name: String(value.name), organizationName: String(value.organizationName), professionalDirection: String(value.professionalDirection) }, context.talents ?? []));
      if (!value.recommenderSourceId) { outcome.classification = "REVIEW"; outcome.issues.push(issue(record, "TALENT_RECOMMENDER_UNRESOLVED", "REVIEW", "无法确定真实推荐人，禁止以迁移管理员代替", "recommenderSourceId")); }
      if (value.resumeTextContactDetected === true) outcome.issues.push(issue(record, "TALENT_CONTACT_EXTRACTION_PROHIBITED", "WARNING", "简历中的电话或邮箱不会抽取为结构化人才联系方式"));
      return outcome;
    }
    case "POLICY":
      return matchOutcome(record, "POLICY", matchPolicy({ title: String(value.title), publishingDepartment: String(value.publishingDepartment), publishedDate: String(value.publishedDate), primaryFileSha256: String(value.primaryFileSha256) }, context.policies ?? []));
    case "DEMAND": {
      const issues: MigrationPreviewIssue[] = [];
      if (value.legacyStatus === "已解决") issues.push(issue(record, "DEMAND_LEGACY_COMPLETED_NO_OUTCOME", "WARNING", "历史已解决需求直接迁为 COMPLETED，不重新办结审核且不伪造 Outcome"));
      if (Array.isArray(value.progress)) for (const progress of value.progress as Array<Record<string, unknown>>) if (!progress.actorPersonSourceId) issues.push(issue(record, "DEMAND_PROGRESS_ACTOR_UNRESOLVED", "REVIEW", "历史进展作者无法匹配，禁止由 SUPER 冒充", "progress.actorPersonSourceId"));
      return { classification: issues.some(({ severity }) => severity === "REVIEW") ? "REVIEW" : "SUCCESS", targetEntity: "DEMAND", immutableHistory: value.legacyStatus === "已解决", issues };
    }
    case "PRESENCE":
      return { classification: "REVIEW", targetEntity: "PRESENCE_REPORT", immutableHistory: true, issues: [issue(record, "MIGRATION_APPLY_UNSUPPORTED", "REVIEW", "当前 Presence schema 无法表达不参与 current presence 的历史记录")] };
    case "TRIP":
      return { classification: "REVIEW", targetEntity: value.stableV2Nodes === true ? "TRIP" : "HISTORICAL_WORK_RECORD", immutableHistory: true, issues: [issue(record, value.stableV2Nodes === true ? "MIGRATION_APPLY_UNSUPPORTED" : "MIGRATION_STATE_UNMAPPABLE", "REVIEW", "当前行程写入链不能安全证明完整多节点历史语义")] };
    case "VISIT":
      return { classification: "REVIEW", targetEntity: "ENTERPRISE_VISIT", immutableHistory: true, issues: [issue(record, "MIGRATION_APPLY_UNSUPPORTED", "REVIEW", "当前 Visit schema 依赖 TripResult，未实现安全历史写入 adapter")] };
    case "REIMBURSEMENT":
      return { classification: "SUCCESS", targetEntity: "REIMBURSEMENT", immutableHistory: value.legacyStatus === "已通过", issues: value.legacyStatus === "已通过" ? [issue(record, "REIMBURSEMENT_LEGACY_VERIFIED_TERMINAL", "WARNING", "V1 已通过映射历史只读终态，绝不进入纸质/财务流转")] : [] };
    case "HELP": {
      const known = HELP_CATEGORIES.has(String(value.legacyCategory));
      if (value.status !== "待受理") return { classification: "REVIEW", targetEntity: "HELP_REQUEST", immutableHistory: value.status === "已办结", issues: [issue(record, "MIGRATION_APPLY_UNSUPPORTED", "REVIEW", "处理中/已办结 Help 缺少可靠 owner 与时间字段，禁止伪造 V2 状态约束")] };
      return { classification: "SUCCESS", targetEntity: "HELP_REQUEST", issues: known ? [] : [issue(record, "HELP_CATEGORY_MAPPED_TO_OTHER", "WARNING", "未知 V1 求助类别映射为 OTHER，并保留原类别快照", "legacyCategory")] };
    }
    case "ANNOUNCEMENT":
      return { classification: "SUCCESS", targetEntity: "ANNOUNCEMENT", immutableHistory: true, issues: value.hasReliableConfirmations === true ? [] : [issue(record, "ANNOUNCEMENT_CONFIRMATIONS_NOT_MIGRATED", "WARNING", "V1 无可靠确认记录，不伪造确认且不回放历史通知")] };
    case "ROLE": {
      const high = HIGH_PRIVILEGE.has(String(value.roleCode));
      if (high && value.explicitlyAuditable !== true) return { classification: "REVIEW", targetEntity: "ROLE_ASSIGNMENT", issues: [issue(record, "HIGH_PRIVILEGE_SOURCE_EVIDENCE_REQUIRED", "REVIEW", "高权限角色没有明确可审计来源，禁止自动赋权", "roleCode")] };
      return { classification: "REVIEW", targetEntity: "ROLE_ASSIGNMENT", issues: [issue(record, "MIGRATION_APPLY_UNSUPPORTED", "REVIEW", "RoleAssignment 尚无 migration-specific 审批证据写入 adapter")] };
    }
  }
}

export function mappedDemandStatus(value: string) { return DEMAND_STATUS_MAP[value as keyof typeof DEMAND_STATUS_MAP]; }
export function mappedDemandType(value?: string) { return value ? DEMAND_TYPE_MAP[value] ?? "OTHER" : "OTHER"; }
export function mappedReimbursementStatus(value: string) { return REIMBURSEMENT_STATUS_MAP[value as keyof typeof REIMBURSEMENT_STATUS_MAP]; }
