import type { ImportRowAction, ImportRowResolutionStatus, ImportType, Prisma, PrismaClient } from "@/generated/prisma/client";
import { matchEnterprise, matchPerson, matchTalent, normalizeComparableText, type MatchIssue } from "@/modules/entity-matching";
import { enterpriseCoreSchema } from "@/modules/enterprise/schemas";
import { talentCoreSchema } from "@/modules/talent/schemas";
import { rowFingerprint } from "./fingerprint";
import type { ParsedImportRow } from "./types";

export type StagedImportRow = {
  rowNumber: number;
  rawJson: Prisma.InputJsonObject;
  normalizedJson: Prisma.InputJsonObject;
  rowFingerprint: string;
  action: ImportRowAction;
  resolutionStatus: ImportRowResolutionStatus;
  matchedEntityId?: string;
  candidateJson?: Prisma.InputJsonObject;
  issuesJson: Prisma.InputJsonArray;
};

type PreviewDatabase = Pick<PrismaClient, "enterprise" | "person" | "talent" | "administrativeArea" | "batch" | "organization">;

type PersonCandidate = {
  id: string;
  name: string;
  contactPhone: string | null;
  personStatus: "ACTIVE" | "ARCHIVED";
  account: { phone: string; status: "PENDING_ENABLE" | "UNACTIVATED" | "NORMAL" | "DISABLED" } | null;
};
type EnterpriseCandidate = {
  id: string;
  name: string;
  responsibleAreaId: string;
  creditCode: string | null;
  status: "NORMAL" | "DISABLED" | "MERGED";
  responsibleArea: { name: string };
};
type TalentCandidate = {
  id: string;
  name: string;
  organizationName: string;
  professionalDirection: string;
  status: "ACTIVE" | "DISABLED" | "MERGED";
};

function issue(code: string, field: string | undefined, severity: MatchIssue["severity"], message: string, candidateIds?: string[]): MatchIssue {
  return { code, field, severity, message, candidateIds };
}
function hasError(issues: readonly MatchIssue[]) { return issues.some(({ severity }) => severity === "ERROR"); }
function hasReview(issues: readonly MatchIssue[]) { return issues.some(({ severity }) => severity === "REVIEW"); }
function jsonIssues(issues: readonly MatchIssue[]): Prisma.InputJsonArray { return issues as unknown as Prisma.InputJsonArray; }
function booleanValue(value: string | undefined): boolean {
  return ["是", "true", "1", "yes", "y"].includes((value ?? "").trim().toLocaleLowerCase("zh-CN"));
}
function memberKind(value: string): "CURRENT" | "HISTORICAL_ALUMNI" | null {
  const normalized = value.trim().toLocaleLowerCase("zh-CN");
  if (["在任", "当前", "current"].includes(normalized)) return "CURRENT";
  if (["历史往届", "往届", "historical_alumni", "alumni"].includes(normalized)) return "HISTORICAL_ALUMNI";
  return null;
}
function scopeType(value: string): "DOMESTIC" | "OVERSEAS" | null {
  const normalized = value.trim().toLocaleLowerCase("zh-CN");
  if (["境内", "国内", "domestic"].includes(normalized)) return "DOMESTIC";
  if (["境外", "海外", "overseas"].includes(normalized)) return "OVERSEAS";
  return null;
}
function dateValue(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const result = new Date(`${value}T00:00:00.000+08:00`);
  return Number.isNaN(result.valueOf()) ? null : result;
}
function exactByName<T extends { id: string; name: string }>(items: readonly T[], name: string | undefined): T[] {
  if (!name) return [];
  const normalized = normalizeComparableText(name);
  return items.filter((item) => normalizeComparableText(item.name) === normalized);
}
function maskedPhone(value: string | null | undefined): string | null {
  return value && /^1\d{10}$/.test(value) ? `${value.slice(0, 3)}****${value.slice(-4)}` : null;
}
function maskedCreditCode(value: string | null | undefined): string | null {
  return value && value.length >= 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : null;
}
export function summarizePersonCandidate(person: PersonCandidate) {
  return { id: person.id, name: person.name, maskedPhone: maskedPhone(person.account?.phone ?? person.contactPhone), personStatus: person.personStatus, accountStatus: person.account?.status ?? null };
}
export function summarizeEnterpriseCandidate(enterprise: EnterpriseCandidate) {
  return { id: enterprise.id, name: enterprise.name, areaName: enterprise.responsibleArea.name, creditCodeMasked: maskedCreditCode(enterprise.creditCode), status: enterprise.status };
}
export function summarizeTalentCandidate(talent: TalentCandidate) {
  return { id: talent.id, name: talent.name, organizationName: talent.organizationName, professionalDirection: talent.professionalDirection, status: talent.status };
}
function buildCandidateJson<T extends { id: string }>(candidateIds: readonly string[], candidates: readonly T[], summarize: (candidate: T) => object): Prisma.InputJsonObject | undefined {
  if (!candidateIds.length) return undefined;
  const wanted = new Set(candidateIds);
  return { candidateIds: [...candidateIds], candidates: candidates.filter(({ id }) => wanted.has(id)).map(summarize) } as unknown as Prisma.InputJsonObject;
}

export async function buildPreviewRows(
  prisma: PreviewDatabase,
  importType: ImportType,
  mappingVersion: number,
  parsedRows: readonly ParsedImportRow[],
): Promise<StagedImportRow[]> {
  const [enterprises, people, talents, areas, batches, organizations] = await Promise.all([
    importType === "ENTERPRISE" ? prisma.enterprise.findMany({ select: { id: true, name: true, responsibleAreaId: true, creditCode: true, address: true, legalRepresentative: true, introduction: true, mainProducts: true, qualificationsHonors: true, status: true, responsibleArea: { select: { name: true } }, primaryContact: { select: { name: true, phone: true, status: true } } } }) : [],
    importType === "MEMBER" || importType === "TALENT" ? prisma.person.findMany({ select: { id: true, name: true, contactPhone: true, personStatus: true, account: { select: { phone: true, status: true } } } }) : [],
    importType === "TALENT" ? prisma.talent.findMany({ where: { status: { not: "MERGED" } }, select: { id: true, name: true, organizationName: true, professionalDirection: true, status: true } }) : [],
    importType === "ENTERPRISE" ? prisma.administrativeArea.findMany({ where: { status: "ACTIVE", type: { in: ["TOWNSHIP", "PARK", "HIGH_TECH_ZONE", "DEVELOPMENT_ZONE"] } }, select: { id: true, name: true } }) : [],
    importType === "MEMBER" ? prisma.batch.findMany({ select: { id: true, name: true, status: true, startDate: true, endDate: true } }) : [],
    importType === "MEMBER" ? prisma.organization.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true, type: true } }) : [],
  ]);
  const seenFingerprints = new Set<string>();
  const enterpriseBatchKeys = new Map<string, { rowNumber: number; core: string }>();
  const enterprisePrimaryKeys = new Map<string, number>();
  const personBatchKeys = new Map<string, { rowNumber: number; name: string }>();
  const result: StagedImportRow[] = [];

  for (const row of parsedRows) {
    const normalized: Record<string, string> = { ...row.normalized };
    const issues: MatchIssue[] = [...row.issues];
    let action: ImportRowAction = "INVALID";
    let resolutionStatus: ImportRowResolutionStatus = "BLOCKED";
    let matchedEntityId: string | undefined;
    let candidateJson: Prisma.InputJsonObject | undefined;

    if (importType === "ENTERPRISE") {
      const areaMatches = exactByName(areas, normalized.responsibleArea);
      if (areaMatches.length !== 1) issues.push(issue("ENTERPRISE_AREA_AMBIGUOUS", "responsibleArea", "REVIEW", areaMatches.length ? "负责区域名称命中多个正式区域" : "负责区域未匹配正式区域", areaMatches.map(({ id }) => id)));
      else normalized.responsibleAreaId = areaMatches[0].id;
      const core = { name: normalized.name, responsibleAreaId: normalized.responsibleAreaId, address: normalized.address, creditCode: normalized.creditCode || undefined,
        legalRepresentative: normalized.legalRepresentative || undefined, introduction: normalized.introduction || undefined,
        mainProducts: normalized.mainProducts, qualificationsHonors: normalized.qualificationsHonors || undefined, tagIds: [] };
      const validation = enterpriseCoreSchema.safeParse(core);
      if (!validation.success) issues.push(issue("ENTERPRISE_ROW_INVALID", undefined, "ERROR", "企业字段格式不正确"));
      if (!hasError(issues) && !hasReview(issues)) {
        const match = matchEnterprise(core, enterprises);
        issues.push(...match.issues);
        matchedEntityId = match.matchedEntityId;
        candidateJson = buildCandidateJson(match.candidateIds, enterprises, summarizeEnterpriseCandidate);
        if (match.kind === "CREATE") action = "CREATE";
        if (match.kind === "EXACT") {
          const existing = enterprises.find(({ id }) => id === match.matchedEntityId)!;
          action = existing.status === "NORMAL" ? "UPDATE" : "MANUAL_REVIEW";
          if (existing.status === "MERGED") issues.push(issue("ENTERPRISE_MATCHED_MERGED", "creditCode", "REVIEW", "信用代码匹配到已合并企业，需先通过企业治理流程处理"));
          if (existing.status === "DISABLED") issues.push(issue("ENTERPRISE_DISABLED_REQUIRES_GOVERNANCE", "creditCode", "REVIEW", "信用代码匹配到已停用企业，需先通过企业治理流程处理"));
          if (booleanValue(normalized.contactPrimary) && existing.primaryContact?.status === "ACTIVE"
            && (existing.primaryContact.name !== normalized.contactName || existing.primaryContact.phone !== normalized.contactPhone)) {
            issues.push(issue("ENTERPRISE_PRIMARY_CONTACT_CONFLICT", "contactPrimary", "REVIEW", "企业已有其他有效主要联系人，需人工确认"));
          }
        }
        if (match.kind === "REVIEW") action = "MANUAL_REVIEW";
        if (match.kind === "INVALID") action = "INVALID";
      }
      if (!hasError(issues) && !hasReview(issues) && normalized.creditCode) {
        const coreSignature = JSON.stringify({ name: normalized.name, responsibleAreaId: normalized.responsibleAreaId, address: normalized.address, mainProducts: normalized.mainProducts });
        const prior = enterpriseBatchKeys.get(normalized.creditCode);
        if (prior && action === "CREATE") {
          if (prior.core === coreSignature) {
            action = "LINK_EXISTING";
            candidateJson = { inBatchRowNumber: prior.rowNumber };
            issues.push(issue("ENTERPRISE_IN_BATCH_CONTACT_ROW", "creditCode", "WARNING", "同批信用代码相同，将复用本批前序企业并处理联系人"));
          } else {
            action = "MANUAL_REVIEW";
            issues.push(issue("ENTERPRISE_IN_BATCH_CONFLICT", "creditCode", "REVIEW", "同批信用代码相同但企业核心字段冲突"));
          }
        } else if (!prior) enterpriseBatchKeys.set(normalized.creditCode, { rowNumber: row.rowNumber, core: coreSignature });
        if (booleanValue(normalized.contactPrimary)) {
          const priorPrimaryRow = enterprisePrimaryKeys.get(normalized.creditCode);
          if (priorPrimaryRow && priorPrimaryRow !== row.rowNumber) issues.push(issue("ENTERPRISE_IN_BATCH_PRIMARY_CONFLICT", "contactPrimary", "REVIEW", "同批同一企业存在多个主要联系人"));
          else enterprisePrimaryKeys.set(normalized.creditCode, row.rowNumber);
        }
      }
    } else if (importType === "MEMBER") {
      const kind = memberKind(normalized.memberKind);
      if (!kind) issues.push(issue("MEMBER_KIND_INVALID", "memberKind", "ERROR", "成员类型必须是在任或历史往届"));
      else normalized.memberKindCode = kind;
      const batchMatches = exactByName(batches, normalized.batch);
      if (batchMatches.length !== 1) issues.push(issue("MEMBER_BATCH_AMBIGUOUS", "batch", "REVIEW", batchMatches.length ? "批次名称命中多条记录" : "批次不存在", batchMatches.map(({ id }) => id)));
      else {
        normalized.batchId = batchMatches[0].id;
        if (kind === "CURRENT" && batchMatches[0].status !== "ACTIVE") issues.push(issue("MEMBER_CURRENT_BATCH_INACTIVE", "batch", "REVIEW", "在任成员只能导入到有效活动批次"));
      }
      const start = dateValue(normalized.startDate);
      const end = normalized.endDate ? dateValue(normalized.endDate) : undefined;
      if (!start || (normalized.endDate && !end) || (start && end && end < start)) issues.push(issue("MEMBER_DATE_INVALID", "startDate", "ERROR", "任期日期格式或区间不正确"));
      for (const [field, allowedTypes] of [["dispatchOrganization", ["DISPATCH_UNIT"]], ["postOrganization", ["POST_UNIT", "TOWNSHIP_ORG", "DEPARTMENT", "OTHER_INTERNAL"]]] as const) {
        if (!normalized[field]) continue;
        const matches = exactByName(organizations.filter(({ type }) => (allowedTypes as readonly string[]).includes(type)), normalized[field]);
        if (matches.length !== 1) issues.push(issue("MEMBER_ORGANIZATION_AMBIGUOUS", field, "REVIEW", `${field === "dispatchOrganization" ? "派出" : "挂职"}单位未唯一匹配正式组织`, matches.map(({ id }) => id)));
        else normalized[`${field}Id`] = matches[0].id;
      }
      if (kind === "HISTORICAL_ALUMNI" && booleanValue(normalized.createAccount)) issues.push(issue("HISTORICAL_ACCOUNT_FORBIDDEN", "createAccount", "ERROR", "历史往届不能通过导入直接开户"));
      const personCandidates = people.map((person) => ({ id: person.id, name: person.name, phone: person.account?.phone ?? person.contactPhone, phones: [person.account?.phone, person.contactPhone],
        personStatus: person.personStatus, accountStatus: person.account?.status ?? null }));
      const match = matchPerson({ name: normalized.name, phone: normalized.phone }, personCandidates);
      issues.push(...match.issues);
      matchedEntityId = match.matchedEntityId;
      candidateJson = buildCandidateJson(match.candidateIds, people, summarizePersonCandidate);
      if (match.kind === "CREATE") action = "CREATE";
      if (match.kind === "EXACT") action = "LINK_EXISTING";
      if (match.kind === "REVIEW") action = "MANUAL_REVIEW";
      if (match.kind === "INVALID") action = "INVALID";
      if (!hasError(issues) && !hasReview(issues) && action === "CREATE") {
        const prior = personBatchKeys.get(normalized.phone);
        if (prior) {
          if (normalizeComparableText(prior.name) === normalizeComparableText(normalized.name)) {
            action = "LINK_EXISTING";
            candidateJson = { inBatchRowNumber: prior.rowNumber };
            issues.push(issue("PERSON_IN_BATCH_MATCH", "phone", "WARNING", "同批手机号相同，将复用前序人员档案"));
          } else {
            action = "MANUAL_REVIEW";
            issues.push(issue("PERSON_IN_BATCH_CONFLICT", "phone", "REVIEW", "同批手机号对应不同姓名"));
          }
        } else personBatchKeys.set(normalized.phone, { rowNumber: row.rowNumber, name: normalized.name });
      }
    } else {
      const scope = scopeType(normalized.scopeType);
      if (!scope) issues.push(issue("TALENT_SCOPE_INVALID", "scopeType", "ERROR", "人才范围必须是境内或境外"));
      else normalized.scopeTypeCode = scope;
      const recommenders = exactByName(people.filter(({ personStatus, account }) => personStatus === "ACTIVE" && account && account.status !== "DISABLED"), normalized.originalRecommender);
      if (recommenders.length !== 1) issues.push(issue("TALENT_RECOMMENDER_AMBIGUOUS", "originalRecommender", "REVIEW", recommenders.length ? "原推荐人姓名命中多个在册人员" : "原推荐人未匹配在册内部人员", recommenders.map(({ id }) => id)));
      else normalized.originalRecommenderPersonId = recommenders[0].id;
      const core = { name: normalized.name, scopeType: normalized.scopeTypeCode, organizationName: normalized.organizationName, title: normalized.title,
        professionalDirection: normalized.professionalDirection, workEducationExperience: normalized.workEducationExperience || undefined,
        representativeAchievements: normalized.representativeAchievements || undefined, originalRecommenderPersonId: normalized.originalRecommenderPersonId };
      if (!talentCoreSchema.safeParse(core).success) issues.push(issue("TALENT_ROW_INVALID", undefined, "ERROR", "人才字段格式不正确"));
      const match = matchTalent({ name: normalized.name, organizationName: normalized.organizationName, professionalDirection: normalized.professionalDirection }, talents);
      issues.push(...match.issues);
      candidateJson = buildCandidateJson(match.candidateIds, talents, summarizeTalentCandidate);
      action = match.kind === "CREATE" ? "CREATE" : match.kind === "INVALID" ? "INVALID" : "MANUAL_REVIEW";
    }

    const fingerprint = rowFingerprint(importType, mappingVersion, normalized);
    if (seenFingerprints.has(fingerprint) && !hasError(issues) && !hasReview(issues)) {
      action = "SKIP";
      issues.push(issue("IMPORT_DUPLICATE_IN_BATCH", undefined, "WARNING", "同批完全重复行已跳过"));
    } else seenFingerprints.add(fingerprint);
    if (hasError(issues)) { action = "INVALID"; resolutionStatus = "BLOCKED"; }
    else if (hasReview(issues) || action === "MANUAL_REVIEW") { action = "MANUAL_REVIEW"; resolutionStatus = "NEEDS_REVIEW"; }
    else resolutionStatus = "AUTO_RESOLVED";
    result.push({ rowNumber: row.rowNumber, rawJson: row.raw as Prisma.InputJsonObject, normalizedJson: normalized as Prisma.InputJsonObject,
      rowFingerprint: fingerprint, action, resolutionStatus, matchedEntityId, candidateJson, issuesJson: jsonIssues(issues) });
  }
  return result;
}
