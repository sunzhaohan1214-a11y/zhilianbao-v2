import ExcelJS from "exceljs";
import type { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import type { AuthRequestContext } from "@/modules/identity/request-context";
import { authorizeActor } from "@/modules/permissions/authorization";
import type { PermissionActor } from "@/modules/permissions/types";
import { ImportExportError } from "./errors";
import { enterpriseExportSchema, talentExportSchema } from "./schemas";

const MAX_EXPORT_ROWS = 5_000;
type ServiceInput = { actor: PermissionActor; context?: AuthRequestContext };

export function escapeExcelFormula(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

export function resolveEnterpriseExportAreaIds(actor: PermissionActor): string[] | null {
  if (actor.hasGlobalOperational && (actor.effectiveRoles.includes("ADMIN") || actor.effectiveRoles.includes("SUPER_ADMIN"))) return null;
  const allowed = new Set<string>();
  if (actor.effectiveRoles.includes("TOWNSHIP_STAFF")) actor.townshipAreaIds.forEach((id) => allowed.add(id));
  if (actor.effectiveRoles.includes("DEPARTMENT_STAFF")) actor.departmentAreaIds.forEach((id) => allowed.add(id));
  return [...allowed];
}

function styleSheet(sheet: ExcelJS.Worksheet) {
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  if (sheet.columnCount) sheet.autoFilter = { from: "A1", to: `${sheet.getColumn(sheet.columnCount).letter}1` };
}

export class DataExportService {
  constructor(private readonly prisma = getPrismaClient()) {}

  async enterprise(input: ServiceInput & { body: unknown }) {
    await authorizeActor({ actor: input.actor, action: "export.create" });
    const body = enterpriseExportSchema.parse(input.body);
    const areaIds = resolveEnterpriseExportAreaIds(input.actor);
    if (areaIds?.length === 0) throw new ImportExportError("EXPORT_FORBIDDEN", "当前账号没有企业批量导出范围");
    if (areaIds && body.areaId && !areaIds.includes(body.areaId)) throw new ImportExportError("EXPORT_FORBIDDEN", "筛选区域超出当前有效数据范围");
    if (areaIds && body.status !== "NORMAL") throw new ImportExportError("EXPORT_FORBIDDEN", "非管理员只能导出正常企业");
    const where: Prisma.EnterpriseWhereInput = {
      ...(areaIds ? { responsibleAreaId: { in: areaIds } } : {}),
      ...(body.areaId ? { responsibleAreaId: body.areaId } : {}),
      status: body.status,
      ...(body.tagId ? { tagRelations: { some: { tagId: body.tagId, tag: { status: "ACTIVE" } } } } : {}),
      ...(body.keyword ? { OR: [{ name: { contains: body.keyword } }, { mainProducts: { contains: body.keyword } }] } : {}),
    };
    const count = await this.prisma.enterprise.count({ where });
    if (count > MAX_EXPORT_ROWS) throw new ImportExportError("EXPORT_TOO_LARGE", "导出结果超过 5000 行，请缩小筛选范围", { rowCount: count, limit: MAX_EXPORT_ROWS });
    const rows = await this.prisma.enterprise.findMany({ where, orderBy: [{ responsibleArea: { sortOrder: "asc" } }, { name: "asc" }, { id: "asc" }], select: {
      name: true, address: true, creditCode: true, legalRepresentative: true, introduction: true, mainProducts: true, qualificationsHonors: true, status: true,
      responsibleArea: { select: { name: true } }, primaryContact: { select: { name: true, positionTitle: true, phone: true, status: true } },
    } });
    const workbook = new ExcelJS.Workbook(); workbook.creator = "智链宝 V2";
    const sheet = workbook.addWorksheet("企业导出");
    sheet.columns = [
      { header: "企业名称", key: "name", width: 28 }, { header: "负责区域", key: "area", width: 18 }, { header: "地址", key: "address", width: 36 },
      { header: "统一社会信用代码", key: "creditCode", width: 24 }, { header: "法定代表人", key: "legal", width: 16 }, { header: "企业简介", key: "introduction", width: 45 },
      { header: "主营产品", key: "products", width: 45 }, { header: "资质荣誉", key: "honors", width: 40 }, { header: "主要联系人", key: "contact", width: 16 },
      { header: "联系人职务", key: "position", width: 18 }, { header: "联系人电话", key: "phone", width: 18 }, { header: "状态", key: "status", width: 14 },
    ];
    for (const row of rows) sheet.addRow({ name: escapeExcelFormula(row.name), area: escapeExcelFormula(row.responsibleArea.name), address: escapeExcelFormula(row.address),
      creditCode: escapeExcelFormula(row.creditCode), legal: escapeExcelFormula(row.legalRepresentative), introduction: escapeExcelFormula(row.introduction),
      products: escapeExcelFormula(row.mainProducts), honors: escapeExcelFormula(row.qualificationsHonors), contact: escapeExcelFormula(row.primaryContact?.status === "ACTIVE" ? row.primaryContact.name : ""),
      position: escapeExcelFormula(row.primaryContact?.status === "ACTIVE" ? row.primaryContact.positionTitle : ""), phone: escapeExcelFormula(row.primaryContact?.status === "ACTIVE" ? row.primaryContact.phone : ""), status: row.status });
    styleSheet(sheet);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    await this.prisma.auditLog.create({ data: { actorPersonId: input.actor.personId, actorAccountId: input.actor.accountId, actionCode: "DATA_EXPORT_CREATED", entityType: "ENTERPRISE_EXPORT",
      afterJson: { effectiveScope: areaIds ? { areaIds } : { countyWide: true }, filters: body, rowCount: rows.length, columns: sheet.columns.map(({ header }) => String(header)) },
      requestId: input.context?.requestId, ip: input.context?.ip, device: input.context?.deviceName } });
    return { buffer, filename: `enterprises-${new Date().toISOString().slice(0, 10)}.xlsx`, rowCount: rows.length };
  }

  async talent(input: ServiceInput & { body: unknown }) {
    await authorizeActor({ actor: input.actor, action: "export.create" });
    if (!input.actor.hasGlobalOperational || (!input.actor.effectiveRoles.includes("ADMIN") && !input.actor.effectiveRoles.includes("SUPER_ADMIN"))) throw new ImportExportError("EXPORT_FORBIDDEN", "只有管理员可以批量导出人才");
    const body = talentExportSchema.parse(input.body);
    const where: Prisma.TalentWhereInput = { status: body.status, scopeType: body.scopeType,
      ...(body.organization ? { organizationName: { contains: body.organization } } : {}),
      ...(body.professionalDirection ? { professionalDirection: { contains: body.professionalDirection } } : {}) };
    const count = await this.prisma.talent.count({ where });
    if (count > MAX_EXPORT_ROWS) throw new ImportExportError("EXPORT_TOO_LARGE", "导出结果超过 5000 行，请缩小筛选范围", { rowCount: count, limit: MAX_EXPORT_ROWS });
    const rows = await this.prisma.talent.findMany({ where, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], select: {
      name: true, scopeType: true, organizationName: true, title: true, professionalDirection: true, workEducationExperience: true,
      representativeAchievements: true, status: true, originalRecommenderPerson: { select: { name: true } }, currentContactPerson: { select: { name: true } },
    } });
    const workbook = new ExcelJS.Workbook(); workbook.creator = "智链宝 V2";
    const sheet = workbook.addWorksheet("人才导出");
    sheet.columns = [
      { header: "姓名", key: "name", width: 18 }, { header: "人才范围", key: "scope", width: 14 }, { header: "工作单位", key: "organization", width: 28 },
      { header: "职务职称", key: "title", width: 22 }, { header: "专业方向", key: "direction", width: 36 }, { header: "工作教育经历", key: "experience", width: 45 },
      { header: "代表性成果", key: "achievements", width: 45 }, { header: "原推荐人", key: "recommender", width: 18 }, { header: "当前联系人", key: "contact", width: 18 }, { header: "状态", key: "status", width: 14 },
    ];
    for (const row of rows) sheet.addRow({ name: escapeExcelFormula(row.name), scope: row.scopeType, organization: escapeExcelFormula(row.organizationName),
      title: escapeExcelFormula(row.title), direction: escapeExcelFormula(row.professionalDirection), experience: escapeExcelFormula(row.workEducationExperience),
      achievements: escapeExcelFormula(row.representativeAchievements), recommender: escapeExcelFormula(row.originalRecommenderPerson.name), contact: escapeExcelFormula(row.currentContactPerson.name), status: row.status });
    styleSheet(sheet);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    await this.prisma.auditLog.create({ data: { actorPersonId: input.actor.personId, actorAccountId: input.actor.accountId, actionCode: "DATA_EXPORT_CREATED", entityType: "TALENT_EXPORT",
      afterJson: { effectiveScope: { countyWide: true }, filters: body, rowCount: rows.length, columns: sheet.columns.map(({ header }) => String(header)) },
      requestId: input.context?.requestId, ip: input.context?.ip, device: input.context?.deviceName } });
    return { buffer, filename: `talents-${new Date().toISOString().slice(0, 10)}.xlsx`, rowCount: rows.length };
  }
}
