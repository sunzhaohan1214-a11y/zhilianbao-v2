import {
  isValidCreditCode,
  isValidMainlandPhone,
  normalizeComparableText,
  normalizeCreditCode,
  normalizeEnterpriseName,
  normalizeImportPhone,
} from "./normalizers";
import type { EntityMatchResult } from "./types";

export type PersonMatchCandidate = { id: string; name: string; phone?: string | null };
export type EnterpriseMatchCandidate = { id: string; name: string; responsibleAreaId: string; creditCode?: string | null };
export type TalentMatchCandidate = { id: string; name: string; organizationName: string; professionalDirection: string };

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
  const exact = candidates.filter((candidate) => candidate.phone === phone);
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
