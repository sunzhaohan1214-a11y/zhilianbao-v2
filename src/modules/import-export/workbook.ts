import ExcelJS from "exceljs";
import type { ImportType } from "@/generated/prisma/client";
import type { MatchIssue } from "@/modules/entity-matching";
import { importFieldRegistry, isProtectedImportHeader, validateMapping } from "./field-registry";
import type { ImportMapping, ParsedImportRow } from "./types";

export const MAX_IMPORT_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5_000;
export const MAX_IMPORT_COLUMNS = 100;
export const MAX_IMPORT_CELL_LENGTH = 20_000;

function asText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map(({ text }) => text).join("");
    if ("text" in value) return String(value.text ?? "");
    if ("result" in value) return asText(value.result as ExcelJS.CellValue);
    return "";
  }
  return String(value);
}

function safeWorkbookText(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function cellValue(cell: ExcelJS.Cell): { text: string; formula: boolean } {
  const value = cell.value;
  const formula = Boolean(value && typeof value === "object" && ("formula" in value || "sharedFormula" in value));
  return { text: asText(value), formula };
}

async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  if (buffer.byteLength < 1 || buffer.byteLength > MAX_IMPORT_FILE_BYTES) throw new Error("IMPORT_BATCH_TOO_LARGE");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);
  if (workbook.worksheets.length === 0) throw new Error("IMPORT_FILE_INVALID");
  return workbook;
}

export async function inspectWorkbook(buffer: Buffer) {
  const workbook = await loadWorkbook(buffer);
  return workbook.worksheets.map((sheet) => ({ name: sheet.name, rowCount: Math.max(0, sheet.actualRowCount - 1), columnCount: sheet.actualColumnCount }));
}

export async function readHeaders(buffer: Buffer, sheetName: string): Promise<string[]> {
  const workbook = await loadWorkbook(buffer);
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) throw new Error("IMPORT_FILE_INVALID");
  if (sheet.actualColumnCount > MAX_IMPORT_COLUMNS) throw new Error("IMPORT_BATCH_TOO_LARGE");
  const headers: string[] = [];
  for (let column = 1; column <= sheet.actualColumnCount; column += 1) headers.push(cellValue(sheet.getCell(1, column)).text.trim());
  if (headers.every((header) => !header)) throw new Error("IMPORT_FILE_INVALID");
  return headers;
}

export async function parseMappedSheet(buffer: Buffer, mapping: ImportMapping, sheetName: string): Promise<ParsedImportRow[]> {
  const validation = validateMapping(mapping);
  if (!validation.valid) throw new Error("IMPORT_MAPPING_INVALID");
  const workbook = await loadWorkbook(buffer);
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) throw new Error("IMPORT_FILE_INVALID");
  if (sheet.actualColumnCount > MAX_IMPORT_COLUMNS || Math.max(0, sheet.actualRowCount - 1) > MAX_IMPORT_ROWS) throw new Error("IMPORT_BATCH_TOO_LARGE");
  const fields = new Map(importFieldRegistry(mapping.importType).map((field) => [field.field, field]));
  const protectedHeaders = mapping.columns.filter(({ sourceHeader, targetField }) => !targetField && isProtectedImportHeader(sourceHeader));
  const rows: ParsedImportRow[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.actualRowCount; rowNumber += 1) {
    const raw: Record<string, string> = {};
    const normalized: Record<string, string> = {};
    const formulaFields: string[] = [];
    const issues: MatchIssue[] = protectedHeaders.map(({ sourceHeader }) => ({ code: "IMPORT_HIGH_PRIVILEGE_COLUMN_IGNORED", severity: "WARNING", message: `高权限列 ${sourceHeader} 已忽略，请使用专门授权流程` }));
    let nonEmpty = false;
    for (const column of mapping.columns) {
      const current = cellValue(sheet.getCell(rowNumber, column.sourceColumn));
      if (current.text.length > MAX_IMPORT_CELL_LENGTH) issues.push({ code: "IMPORT_CELL_TOO_LONG", field: column.targetField ?? undefined, severity: "ERROR", message: "单元格内容超过允许长度" });
      if (current.text.trim()) nonEmpty = true;
      raw[`${column.sourceColumn}:${column.sourceHeader}`] = current.text;
      if (!column.targetField) continue;
      const definition = fields.get(column.targetField)!;
      normalized[column.targetField] = definition.normalize ? definition.normalize(current.text) : current.text.trim();
      if (current.formula) {
        formulaFields.push(column.targetField);
        issues.push(definition.identity
          ? { code: "IMPORT_IDENTITY_FORMULA_BLOCKED", field: column.targetField, severity: "ERROR", message: "关键身份字段不能使用公式" }
          : { code: "IMPORT_FORMULA_CACHED_VALUE", field: column.targetField, severity: "WARNING", message: "公式单元格使用了工作簿缓存值" });
      }
    }
    if (!nonEmpty) continue;
    for (const field of fields.values()) {
      if (field.required && !normalized[field.field]?.trim()) issues.push({ code: "IMPORT_REQUIRED_FIELD_MISSING", field: field.field, severity: "ERROR", message: `${field.label}不能为空` });
    }
    rows.push({ rowNumber, raw, normalized, formulaFields, issues });
  }
  return rows;
}

export async function buildImportTemplate(importType: ImportType): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "智链宝 V2";
  const sheet = workbook.addWorksheet(`${importType}导入模板`);
  const fields = importFieldRegistry(importType);
  sheet.addRow(fields.map(({ label, required }) => `${label}${required ? "*" : ""}`));
  sheet.addRow(fields.map(({ example }) => example));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  fields.forEach((_field, index) => { sheet.getColumn(index + 1).width = 22; });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function buildImportResultWorkbook(input: { importType: ImportType; rows: readonly { rowNumber: number; normalizedJson: unknown; action: string; resolutionStatus: string; issuesJson: unknown }[] }): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook(); workbook.creator = "智链宝 V2";
  const sheet = workbook.addWorksheet("导入结果");
  sheet.columns = [
    { header: "源行号", key: "rowNumber", width: 12 }, { header: "业务标识", key: "identifier", width: 30 },
    { header: "动作", key: "action", width: 18 }, { header: "结果", key: "result", width: 18 }, { header: "问题摘要", key: "issues", width: 60 },
  ];
  for (const row of input.rows) {
    const normalized = row.normalizedJson && typeof row.normalizedJson === "object" && !Array.isArray(row.normalizedJson) ? row.normalizedJson as Record<string, unknown> : {};
    const identifier = input.importType === "ENTERPRISE" ? normalized.name : input.importType === "MEMBER" ? `${normalized.name ?? ""} ${normalized.phone ? String(normalized.phone).replace(/^(\d{3})\d{4}(\d{4})$/, "$1****$2") : ""}` : normalized.name;
    const issues = Array.isArray(row.issuesJson) ? row.issuesJson.map((entry) => entry && typeof entry === "object" && "message" in entry ? String(entry.message) : "").filter(Boolean).join("；") : "";
    sheet.addRow({ rowNumber: row.rowNumber, identifier: safeWorkbookText(identifier), action: safeWorkbookText(row.action), result: safeWorkbookText(row.resolutionStatus), issues: safeWorkbookText(issues) });
  }
  sheet.getRow(1).font = { bold: true }; sheet.views = [{ state: "frozen", ySplit: 1 }]; sheet.autoFilter = { from: "A1", to: "E1" };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
