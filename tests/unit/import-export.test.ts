import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { ImportType, RoleCode } from "@/generated/prisma/client";
import { matchEnterprise, matchPerson, matchTalent, normalizeCreditCode, normalizeImportPhone } from "@/modules/entity-matching";
import { autoMapHeaders, importFieldRegistry, isProtectedImportHeader, validateMapping } from "@/modules/import-export/field-registry";
import { rowFingerprint } from "@/modules/import-export/fingerprint";
import { escapeExcelFormula, resolveEnterpriseExportAreaIds } from "@/modules/import-export/export-service";
import { summarizeEnterpriseCandidate, summarizePersonCandidate, summarizeTalentCandidate } from "@/modules/import-export/preview";
import { buildImportResultWorkbook, parseMappedSheet } from "@/modules/import-export/workbook";
import { resolveCapabilities, type PermissionActor } from "@/modules/permissions";

function actor(roles: RoleCode[], townships: string[] = [], departments: string[] = []): PermissionActor {
  return { personId: "p", accountId: "a", accountStatus: "NORMAL", permissionVersion: BigInt(1), effectiveRoles: roles,
    capabilities: resolveCapabilities(roles, new Set()), specialPermissions: new Set(), selfPersonId: "p", townshipAreaIds: townships,
    departmentAreaIds: departments, hasGlobalPublished: true, hasGlobalOperational: roles.includes("ADMIN") || roles.includes("SUPER_ADMIN"),
    hasSystem: roles.includes("SUPER_ADMIN"), currentBatchMember: false, configurationIssues: [] };
}

describe("M3-005 deterministic field registry", () => {
  it("maps documented aliases and reports missing required fields", () => {
    const enterprise = autoMapHeaders("ENTERPRISE", ["企业", "信用代码", "所属镇区", "企业地址", "主营产品"]);
    expect(enterprise.mapping.columns.map(({ targetField }) => targetField)).toEqual(["name", "creditCode", "responsibleArea", "address", "mainProducts"]);
    expect(enterprise.missingRequiredFields).toEqual([]);
    expect(autoMapHeaders("MEMBER", ["团员姓名", "手机号码"]).missingRequiredFields).toEqual(expect.arrayContaining(["batch", "memberKind", "startDate"]));
  });

  it("rejects duplicate target fields and never exposes high privilege fields", () => {
    expect(validateMapping({ importType: "ENTERPRISE", columns: [
      { sourceColumn: 1, sourceHeader: "甲", targetField: "name" }, { sourceColumn: 2, sourceHeader: "乙", targetField: "name" },
    ] }).duplicateTargetFields).toEqual(["name"]);
    const targets = (["ENTERPRISE", "MEMBER", "TALENT"] as ImportType[]).flatMap((type) => importFieldRegistry(type).map(({ field }) => field));
    for (const forbidden of ["role", "roleCode", "ADMIN", "SUPER_ADMIN", "specialPermission", "phone", "email"]) {
      if (forbidden === "phone") expect(importFieldRegistry("TALENT").map(({ field }) => field)).not.toContain(forbidden);
      else expect(targets).not.toContain(forbidden);
    }
    expect(isProtectedImportHeader("角色")).toBe(true);
    expect(isProtectedImportHeader("Special Permission")).toBe(true);
  });

  it("leaves ambiguous duplicate alias headers unmapped deterministically", () => {
    const mapped = autoMapHeaders("ENTERPRISE", ["企业名称", "单位名称", "负责区域", "地址", "主营产品"]);
    expect(mapped.mapping.columns.slice(0, 2).map(({ targetField }) => targetField)).toEqual([null, null]);
    expect(mapped.missingRequiredFields).toContain("name");
  });

  it("changes fingerprints with mapping versions and keeps key order stable", () => {
    expect(rowFingerprint("ENTERPRISE", 1, { name: "甲", address: "乙" })).toBe(rowFingerprint("ENTERPRISE", 1, { address: "乙", name: "甲" }));
    expect(rowFingerprint("ENTERPRISE", 1, { name: "甲" })).not.toBe(rowFingerprint("ENTERPRISE", 2, { name: "甲" }));
  });
});

describe("M3-005 entity matchers", () => {
  it("matches a person only by exact valid phone and reviews same-name different-phone", () => {
    const candidates = [{ id: "one", name: "张三", phone: "13800000000" }];
    expect(matchPerson({ name: "其他姓名", phone: "13800000000" }, candidates)).toMatchObject({ kind: "EXACT", matchedEntityId: "one" });
    expect(matchPerson({ name: "张三", phone: "13900000000" }, candidates)).toMatchObject({ kind: "REVIEW" });
    expect(matchPerson({ name: "张三" }, candidates)).toMatchObject({ kind: "REVIEW" });
    expect(matchPerson({ name: "张三", phone: "138-0000-0000" }, candidates)).toMatchObject({ kind: "INVALID" });
  });

  it("blocks an exact archived person instead of creating a duplicate", () => {
    const archived = [{ id: "archived", name: "归档人员", phone: "13800000000", personStatus: "ARCHIVED" as const, accountStatus: null }];
    expect(matchPerson({ name: "归档人员", phone: "13800000000" }, archived)).toMatchObject({
      kind: "REVIEW",
      candidateIds: ["archived"],
      issues: [expect.objectContaining({ code: "PERSON_ARCHIVED_REQUIRES_GOVERNANCE" })],
    });
  });

  it("uses enterprise credit code exactly and treats name-area without code as review only", () => {
    const candidates = [{ id: "e", name: "宝应装备有限公司", responsibleAreaId: "area", creditCode: "913210231234567890" }];
    expect(matchEnterprise({ name: "不同名称", responsibleAreaId: "other", creditCode: "913210231234567890" }, candidates)).toMatchObject({ kind: "EXACT", matchedEntityId: "e" });
    expect(matchEnterprise({ name: "宝应装备有限公司", responsibleAreaId: "area" }, candidates)).toMatchObject({ kind: "REVIEW" });
    expect(matchEnterprise({ name: "宝应装备有限公司", responsibleAreaId: "area", creditCode: "913210239999999999" }, candidates)).toMatchObject({ kind: "CREATE" });
    expect(matchEnterprise({ name: "宝应装备有限公司", responsibleAreaId: "other" }, candidates)).toMatchObject({ kind: "CREATE" });
  });

  it("requires governance for disabled and merged exact enterprise matches", () => {
    const core = { id: "e", name: "停用企业", responsibleAreaId: "area", creditCode: "913210231234567890" };
    expect(matchEnterprise({ name: core.name, responsibleAreaId: "area", creditCode: core.creditCode }, [{ ...core, status: "NORMAL" }])).toMatchObject({ kind: "EXACT" });
    expect(matchEnterprise({ name: core.name, responsibleAreaId: "area", creditCode: core.creditCode }, [{ ...core, status: "DISABLED" }])).toMatchObject({ kind: "REVIEW", issues: [expect.objectContaining({ code: "ENTERPRISE_DISABLED_REQUIRES_GOVERNANCE" })] });
    expect(matchEnterprise({ name: core.name, responsibleAreaId: "area", creditCode: core.creditCode }, [{ ...core, status: "MERGED" }])).toMatchObject({ kind: "REVIEW", issues: [expect.objectContaining({ code: "ENTERPRISE_MATCHED_MERGED" })] });
  });

  it("returns minimal masked candidate summaries", () => {
    const person = summarizePersonCandidate({ id: "p", name: "张三", contactPhone: "13800001234", personStatus: "ARCHIVED", account: null });
    expect(person).toEqual({ id: "p", name: "张三", maskedPhone: "138****1234", personStatus: "ARCHIVED", accountStatus: null });
    expect(JSON.stringify(person)).not.toContain("13800001234");
    expect(summarizeEnterpriseCandidate({ id: "e", name: "企业", responsibleAreaId: "a", responsibleArea: { name: "安宜镇" }, creditCode: "913210231234567890", status: "DISABLED" })).toEqual({ id: "e", name: "企业", areaName: "安宜镇", creditCodeMasked: "9132…7890", status: "DISABLED" });
    expect(summarizeTalentCandidate({ id: "t", name: "人才", organizationName: "研究院", professionalDirection: "装备", status: "ACTIVE" })).toEqual({ id: "t", name: "人才", organizationName: "研究院", professionalDirection: "装备", status: "ACTIVE" });
  });

  it("never auto-merges talents", () => {
    const candidates = [{ id: "t", name: "李四", organizationName: "研究院", professionalDirection: "电力装备" }];
    expect(matchTalent({ name: "李四", organizationName: "研究院", professionalDirection: "电力装备" }, candidates)).toMatchObject({ kind: "REVIEW" });
    expect(matchTalent({ name: "李四", organizationName: "其他单位", professionalDirection: "其他" }, candidates)).toMatchObject({ kind: "CREATE" });
  });

  it("uses trim-only phone normalization and uppercase credit normalization", () => {
    expect(normalizeImportPhone(" 13800000000 ")).toBe("13800000000");
    expect(normalizeImportPhone("138-0000-0000")).toBe("138-0000-0000");
    expect(normalizeCreditCode(" 9132abc ")).toBe("9132ABC");
  });
});

describe("M3-005 workbook safety and export scope", () => {
  it("blocks formula identity cells and warns for cached formulas in ordinary fields", async () => {
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Sheet1");
    sheet.addRow(["企业名称", "镇区", "地址", "主营产品"]);
    sheet.addRow([{ formula: "CONCAT(\"恶意\",\"企业\")", result: "恶意企业" }, "安宜镇", "地址", { formula: "CONCAT(\"产品\",\"A\")", result: "产品A" }]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer()); const mapping = autoMapHeaders("ENTERPRISE", ["企业名称", "镇区", "地址", "主营产品"]).mapping;
    const [row] = await parseMappedSheet(buffer, mapping, "Sheet1");
    expect(row.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "IMPORT_IDENTITY_FORMULA_BLOCKED", field: "name", severity: "ERROR" }), expect.objectContaining({ code: "IMPORT_FORMULA_CACHED_VALUE", field: "mainProducts", severity: "WARNING" })]));
  });

  it("warns when a high-privilege source column is ignored", async () => {
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Sheet1");
    sheet.addRow(["企业名称", "镇区", "地址", "主营产品", "角色"]); sheet.addRow(["安全企业", "安宜镇", "地址", "产品", "SUPER_ADMIN"]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer()); const mapping = autoMapHeaders("ENTERPRISE", ["企业名称", "镇区", "地址", "主营产品", "角色"]).mapping;
    const [row] = await parseMappedSheet(buffer, mapping, "Sheet1");
    expect(row.issues).toContainEqual(expect.objectContaining({ code: "IMPORT_HIGH_PRIVILEGE_COLUMN_IGNORED", severity: "WARNING" }));
  });

  it("escapes all Excel formula injection prefixes", () => {
    for (const value of ["=HYPERLINK(\"x\")", "+CMD", "-1+1", "@SUM(A1:A2)"]) expect(escapeExcelFormula(value)).toBe(`'${value}`);
    expect(escapeExcelFormula("普通文本")).toBe("普通文本");
  });

  it("escapes formula prefixes in downloadable import result workbooks", async () => {
    const buffer = await buildImportResultWorkbook({ importType: "ENTERPRISE", rows: [{ rowNumber: 2, normalizedJson: { name: "=HYPERLINK(\"x\")" }, action: "CREATE", resolutionStatus: "AUTO_RESOLVED", issuesJson: [] }] });
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as never);
    expect(workbook.worksheets[0].getCell("B2").value).toBe("'=HYPERLINK(\"x\")");
  });

  it("resolves county, township and department enterprise export scopes", () => {
    expect(resolveEnterpriseExportAreaIds(actor(["ADMIN"]))).toBeNull();
    expect(resolveEnterpriseExportAreaIds(actor(["TOWNSHIP_STAFF"], ["town-a"]))).toEqual(["town-a"]);
    expect(resolveEnterpriseExportAreaIds(actor(["DEPARTMENT_STAFF"], [], ["town-a", "town-b"]))).toEqual(["town-a", "town-b"]);
    expect(resolveEnterpriseExportAreaIds(actor(["MEMBER_CURRENT"]))).toEqual([]);
  });
});
