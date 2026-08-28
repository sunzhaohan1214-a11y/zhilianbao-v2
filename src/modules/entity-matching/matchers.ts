import {
  isValidCreditCode,
  isValidMainlandPhone,
  normalizeComparableText,
  normalizeCreditCode,
  normalizeEnterpriseName,
  normalizeImportPhone,
} from "./normalizers";
import type { EntityMatchResult } from "./types";

export type PersonMatchCandidate = {
  id: string;
  name: string;
  phone?: string | null;
  phones?: readonly (string | null | undefined)[];
  personStatus?: "ACTIVE" | "ARCHIVED";
  accountStatus?: "PENDING_ENABLE" | "UNACTIVATED" | "NORMAL" | "DISABLED" | null;
};
export type EnterpriseMatchCandidate = { id: string; name: string; responsibleAreaId: string; creditCode?: string | null; status?: "NORMAL" | "DISABLED" | "MERGED" };
export type TalentMatchCandidate = { id: string; name: string; organizationName: string; professionalDirection: string };
export type PolicyMatchCandidate = { id: string; title: string; publishingDepartment: string; publishedDate: string; primaryFileSha256: string };

export function matchPerson(
  input: { name: string; phone?: string | null },
  candidates: readonly PersonMatchCandidate[],
): EntityMatchResult {
  const phone = input.phone ? normalizeImportPhone(input.phone) : "";
  if (!phone) {
    return { kind: "REVIEW", candidateIds: [], issues: [{ code: "PERSON_PHONE_MISSING", field: "phone", severity: "REVIEW", message: "手机号缺失，不能自动匹配人员" }] };
  }
  if (!isValidMainlandPhone(phone)) {
    return { kind: "INVALID", candidateIds: [], issues: [{ code: "PERSON_PHONE_INVALID", field: "phone", severity: "ERROR", message: "手机号必须是合法的 11 位大陆手机号" }] };
  }
  const exact = candidates.filter((candidate) => [candidate.phone, ...(candidate.phones ?? [])].some((candidatePhone) => candidatePhone === phone));
  if (exact.length === 1 && exact[0].personStatus === "ARCHIVED") {
    return { kind: "REVIEW", candidateIds: [exact[0].id], issues: [{ code: "PERSON_ARCHIVED_REQUIRES_GOVERNANCE", field: "phone", severity: "REVIEW", message: "手机号命中已归档人员，需先通过人员治理流程处理", candidateIds: [exact[0].id] }] };
  }
  if (exact.length === 1) return { kind: "EXACT", matchedEntityId: exact[0].id, candidateIds: [exact[0].id], issues: [] };
  if (exact.length > 1) {
    return { kind: "REVIEW", candidateIds: exact.map(({ id }) => id), issues: [{ code: "PERSON_PHONE_DUPLICATED", field: "phone", severity: "REVIEW", message: "手机号命中多个人员档案", candidateIds: exact.map(({ id }) => id) }] };
  }
  const normalizedName = normalizeComparableText(input.name);
  const sameName = candidates.filter((candidate) => normalizeComparableText(candidate.name) === normalizedName);
  if (sameName.length > 0) {
    return { kind: "REVIEW", candidateIds: sameName.map(({ id }) => id), issues: [{ code: "PERSON_SAME_NAME_DIFFERENT_PHONE", field: "name", severity: "REVIEW", message: "存在同名但手机号不同的人员，禁止自动合并", candidateIds: sameName.map(({ id }) => id) }] };
  }
  return { kind: "CREATE", candidateIds: [], issues: [] };
}

export function matchEnterprise(
  input: { name: string; responsibleAreaId: string; creditCode?: string | null },
  candidates: readonly EnterpriseMatchCandidate[],
): EntityMatchResult {
  const creditCode = input.creditCode ? normalizeCreditCode(input.creditCode) : "";
  if (creditCode) {
    if (!isValidCreditCode(creditCode)) {
      return { kind: "INVALID", candidateIds: [], issues: [{ code: "ENTERPRISE_CREDIT_CODE_INVALID", field: "creditCode", severity: "ERROR", message: "统一社会信用代码格式不正确" }] };
    }
    const exact = candidates.filter((candidate) => candidate.creditCode && normalizeCreditCode(candidate.creditCode) === creditCode);
    if (exact.length === 1 && exact[0].status === "DISABLED") {
      return { kind: "REVIEW", candidateIds: [exact[0].id], issues: [{ code: "ENTERPRISE_DISABLED_REQUIRES_GOVERNANCE", field: "creditCode", severity: "REVIEW", message: "信用代码命中已停用企业，需先通过企业治理流程处理", candidateIds: [exact[0].id] }] };
    }
    if (exact.length === 1 && exact[0].status === "MERGED") {
      return { kind: "REVIEW", candidateIds: [exact[0].id], issues: [{ code: "ENTERPRISE_MATCHED_MERGED", field: "creditCode", severity: "REVIEW", message: "信用代码命中已合并企业，需先通过企业治理流程处理", candidateIds: [exact[0].id] }] };
    }
    if (exact.length === 1) return { kind: "EXACT", matchedEntityId: exact[0].id, candidateIds: [exact[0].id], issues: [] };
    if (exact.length > 1) {
      return { kind: "REVIEW", candidateIds: exact.map(({ id }) => id), issues: [{ code: "ENTERPRISE_CREDIT_CODE_DUPLICATED", field: "creditCode", severity: "REVIEW", message: "信用代码命中多个企业档案", candidateIds: exact.map(({ id }) => id) }] };
    }
    return { kind: "CREATE", candidateIds: [], issues: [] };
  }
  const normalizedName = normalizeEnterpriseName(input.name);
  const possible = candidates.filter((candidate) => candidate.responsibleAreaId === input.responsibleAreaId && normalizeEnterpriseName(candidate.name) === normalizedName);
  if (possible.length > 0) {
    return { kind: "REVIEW", candidateIds: possible.map(({ id }) => id), issues: [{ code: "ENTERPRISE_NAME_AREA_CANDIDATE", field: "name", severity: "REVIEW", message: "缺少信用代码，仅按企业名称和负责区域提示可能重复", candidateIds: possible.map(({ id }) => id) }] };
  }
  return { kind: "CREATE", candidateIds: [], issues: [] };
}

export function matchTalent(
  input: { name: string; organizationName: string; professionalDirection: string },
  candidates: readonly TalentMatchCandidate[],
): EntityMatchResult {
  const exact = candidates.filter((candidate) =>
    normalizeComparableText(candidate.name) === normalizeComparableText(input.name)
    && normalizeComparableText(candidate.organizationName) === normalizeComparableText(input.organizationName)
    && normalizeComparableText(candidate.professionalDirection) === normalizeComparableText(input.professionalDirection));
  if (exact.length > 0) {
    return { kind: "REVIEW", candidateIds: exact.map(({ id }) => id), issues: [{ code: "TALENT_DUPLICATE_CANDIDATE", field: "name", severity: "REVIEW", message: "姓名、单位和专业方向相同，需人工确认", candidateIds: exact.map(({ id }) => id) }] };
  }
  return { kind: "CREATE", candidateIds: [], issues: [] };
}

export function matchPolicy(
  input: { title: string; publishingDepartment: string; publishedDate: string; primaryFileSha256: string },
  candidates: readonly PolicyMatchCandidate[],
): EntityMatchResult {
  const matches = candidates.filter((candidate) =>
    normalizeComparableText(candidate.title) === normalizeComparableText(input.title)
    && normalizeComparableText(candidate.publishingDepartment) === normalizeComparableText(input.publishingDepartment)
    && candidate.publishedDate === input.publishedDate
    && candidate.primaryFileSha256.toLowerCase() === input.primaryFileSha256.toLowerCase());
  if (matches.length === 1) return { kind: "EXACT", matchedEntityId: matches[0].id, candidateIds: [matches[0].id], issues: [] };
  if (matches.length > 1) return { kind: "REVIEW", candidateIds: matches.map(({ id }) => id), issues: [{ code: "POLICY_IDENTITY_DUPLICATED", severity: "REVIEW", message: "政策四要素命中多条正式记录，需人工确认", candidateIds: matches.map(({ id }) => id) }] };
  return { kind: "CREATE", candidateIds: [], issues: [] };
}
