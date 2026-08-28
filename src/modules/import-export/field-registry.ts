import type { ImportType } from "@/generated/prisma/client";
import { normalizeCreditCode, normalizeImportPhone } from "@/modules/entity-matching";
import type { ImportColumnMapping, ImportFieldDefinition, ImportMapping } from "./types";

function trim(value: string) { return value.trim(); }

const REGISTRY: Readonly<Record<ImportType, readonly ImportFieldDefinition[]>> = {
  ENTERPRISE: [
    { field: "name", label: "企业名称", required: true, identity: true, aliases: ["企业名称", "企业", "单位名称"], example: "示例企业（请替换）", normalize: trim },
    { field: "creditCode", label: "统一社会信用代码", required: false, identity: true, aliases: ["统一社会信用代码", "信用代码"], example: "15-32位代码", normalize: normalizeCreditCode },
    { field: "responsibleArea", label: "负责区域", required: true, aliases: ["镇区", "所属镇区", "负责区域", "所属区域"], example: "正式区域名称", normalize: trim },
    { field: "address", label: "地址", required: true, aliases: ["地址", "企业地址", "注册地址"], example: "企业地址", normalize: trim },
    { field: "legalRepresentative", label: "法定代表人", required: false, aliases: ["法定代表人", "法人"], example: "选填", normalize: trim },
    { field: "introduction", label: "企业简介", required: false, aliases: ["企业简介", "简介"], example: "选填", normalize: trim },
    { field: "mainProducts", label: "主营产品", required: true, aliases: ["主营产品", "主要产品", "产品"], example: "主营产品或服务", normalize: trim },
    { field: "qualificationsHonors", label: "资质荣誉", required: false, aliases: ["资质荣誉", "荣誉", "资质"], example: "选填", normalize: trim },
    { field: "contactName", label: "联系人姓名", required: false, aliases: ["联系人姓名", "联系人"], example: "选填", normalize: trim },
    { field: "contactPosition", label: "联系人职务", required: false, aliases: ["联系人职务", "职务"], example: "选填", normalize: trim },
    { field: "contactPhone", label: "联系人电话", required: false, aliases: ["联系人电话", "联系电话", "电话"], example: "选填", normalize: trim },
    { field: "contactPrimary", label: "是否主要联系人", required: false, aliases: ["是否主要联系人", "主要联系人"], example: "是/否", normalize: trim },
  ],
  MEMBER: [
    { field: "name", label: "姓名", required: true, identity: true, aliases: ["姓名", "团员姓名"], example: "成员姓名", normalize: trim },
    { field: "phone", label: "手机号", required: true, identity: true, aliases: ["手机号", "手机号码", "联系电话"], example: "11位大陆手机号", normalize: normalizeImportPhone },
    { field: "batch", label: "批次", required: true, aliases: ["批次", "目标批次", "任职批次"], example: "正式批次名称", normalize: trim },
    { field: "memberKind", label: "成员类型", required: true, aliases: ["成员类型", "在任往届", "团员类型"], example: "在任/历史往届", normalize: trim },
    { field: "dispatchOrganization", label: "派出单位", required: false, aliases: ["派出单位", "选派单位"], example: "正式组织名称", normalize: trim },
    { field: "postOrganization", label: "挂职单位", required: false, aliases: ["挂职单位"], example: "正式组织名称", normalize: trim },
    { field: "positionTitle", label: "任职职务", required: false, aliases: ["任职职务", "挂职职务", "职务"], example: "选填", normalize: trim },
    { field: "startDate", label: "开始日期", required: true, aliases: ["开始日期", "任期开始"], example: "YYYY-MM-DD", normalize: trim },
    { field: "endDate", label: "结束日期", required: false, aliases: ["结束日期", "任期结束"], example: "YYYY-MM-DD或留空", normalize: trim },
    { field: "professionalDirection", label: "专业方向", required: false, aliases: ["专业方向", "研究方向"], example: "选填", normalize: trim },
    { field: "coordinatableResources", label: "可协调资源", required: false, aliases: ["可协调资源", "协调资源"], example: "选填", normalize: trim },
    { field: "createAccount", label: "创建账号", required: false, aliases: ["创建账号", "是否开户"], example: "是/否；历史往届默认否", normalize: trim },
  ],
  TALENT: [
    { field: "name", label: "姓名", required: true, identity: true, aliases: ["姓名", "人才姓名"], example: "人才姓名", normalize: trim },
    { field: "scopeType", label: "人才范围", required: true, aliases: ["人才范围", "境内境外", "范围"], example: "境内/境外", normalize: trim },
    { field: "organizationName", label: "工作单位", required: true, aliases: ["单位", "工作单位"], example: "工作单位", normalize: trim },
    { field: "title", label: "职务职称", required: true, aliases: ["职务职称", "职务", "职称"], example: "职务或职称", normalize: trim },
    { field: "professionalDirection", label: "专业方向", required: true, aliases: ["专业方向", "研究方向"], example: "专业方向", normalize: trim },
    { field: "workEducationExperience", label: "工作教育经历", required: false, aliases: ["工作教育经历", "工作经历", "教育经历"], example: "选填", normalize: trim },
    { field: "representativeAchievements", label: "代表性成果", required: false, aliases: ["代表性成果", "主要成果"], example: "选填", normalize: trim },
    { field: "originalRecommender", label: "原推荐人", required: true, aliases: ["原推荐人", "推荐人", "内部推荐人"], example: "平台内部人员姓名", normalize: trim },
  ],
};

export function normalizeHeader(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("zh-CN").replace(/[\s_\-—:：/\\*＊]+/g, "");
}

const PROTECTED_IMPORT_HEADERS = new Set([
  "角色", "role", "rolecode", "管理员", "超级管理员", "admin", "superadmin", "部长", "组长", "高权限",
  "specialpermission", "特殊权限", "报销管理", "aiservicemanage",
].map(normalizeHeader));

export function isProtectedImportHeader(value: string): boolean {
  return PROTECTED_IMPORT_HEADERS.has(normalizeHeader(value));
}

export function importFieldRegistry(importType: ImportType): readonly ImportFieldDefinition[] {
  return REGISTRY[importType];
}

export function autoMapHeaders(importType: ImportType, headers: readonly string[]) {
  const fields = importFieldRegistry(importType);
  const columns: ImportColumnMapping[] = headers.map((sourceHeader, index) => {
    const header = normalizeHeader(sourceHeader);
    const matches = fields.filter((field) => field.aliases.some((alias) => normalizeHeader(alias) === header));
    return { sourceColumn: index + 1, sourceHeader, targetField: matches.length === 1 ? matches[0].field : null };
  });
  const targetCounts = new Map<string, number>();
  for (const column of columns) if (column.targetField) targetCounts.set(column.targetField, (targetCounts.get(column.targetField) ?? 0) + 1);
  for (const column of columns) if (column.targetField && targetCounts.get(column.targetField)! > 1) column.targetField = null;
  const mapped = new Set(columns.flatMap((column) => column.targetField ? [column.targetField] : []));
  const missingRequiredFields = fields.filter((field) => field.required && !mapped.has(field.field)).map((field) => field.field);
  return { mapping: { importType, columns } satisfies ImportMapping, missingRequiredFields };
}

export function validateMapping(mapping: ImportMapping): { valid: boolean; missingRequiredFields: string[]; duplicateTargetFields: string[]; unknownTargetFields: string[] } {
  const fields = importFieldRegistry(mapping.importType);
  const allowed = new Set(fields.map(({ field }) => field));
  const targets = mapping.columns.flatMap(({ targetField }) => targetField ? [targetField] : []);
  const duplicateTargetFields = [...new Set(targets.filter((target, index) => targets.indexOf(target) !== index))];
  const unknownTargetFields = [...new Set(targets.filter((target) => !allowed.has(target)))];
  const mapped = new Set(targets);
  const missingRequiredFields = fields.filter((field) => field.required && !mapped.has(field.field)).map(({ field }) => field);
  return { valid: missingRequiredFields.length === 0 && duplicateTargetFields.length === 0 && unknownTargetFields.length === 0, missingRequiredFields, duplicateTargetFields, unknownTargetFields };
}
