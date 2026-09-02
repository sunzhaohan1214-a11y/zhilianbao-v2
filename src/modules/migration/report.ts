import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import type { MigrationPreviewIssue, MigrationReconciliation } from "./types";

function safeCell(value: string): string { return /^[=+\-@]/.test(value) ? `'${value}` : value; }

export async function writeMigrationReports(outputDirectory: string, reconciliation: MigrationReconciliation, issues: MigrationPreviewIssue[]) {
  await mkdir(outputDirectory, { recursive: true });
  const stem = reconciliation.mode === "SAMPLE_REHEARSAL" ? "migration-sample" : "migration-full";
  const jsonPath = path.join(outputDirectory, `${stem}-reconciliation.json`);
  const issuesPath = path.join(outputDirectory, `${stem}-issues.json`);
  const xlsxPath = path.join(outputDirectory, `${stem}-reconciliation.xlsx`);
  await writeFile(jsonPath, `${JSON.stringify(reconciliation, null, 2)}\n`, "utf8");
  const reportIssues = issues.map((value) => ({
    sourceEntity: value.sourceEntity,
    sourceId: value.sourceId,
    code: value.code,
    severity: value.severity,
    field: value.field,
    message: value.message,
    candidateCount: value.candidates?.length ?? 0,
  }));
  await writeFile(issuesPath, `${JSON.stringify({ snapshotId: reconciliation.snapshotId, issueCount: reportIssues.length, issues: reportIssues }, null, 2)}\n`, "utf8");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "智链宝 V1 Migration";
  const summary = workbook.addWorksheet("Reconciliation");
  summary.columns = [
    ["module", "模块", 22], ["sourceCount", "源记录数", 14], ["successCount", "成功", 12], ["failedCount", "失败", 12],
    ["skippedCount", "跳过", 12], ["mergedCount", "合并/关联", 14], ["reviewCount", "待确认", 12], ["attachmentCount", "附件总数", 14],
    ["attachmentSuccessCount", "附件成功", 14], ["attachmentIssueCount", "附件异常", 14],
  ].map(([key, header, width]) => ({ key: String(key), header: String(header), width: Number(width) }));
  for (const moduleResult of reconciliation.modules) summary.addRow(moduleResult);
  summary.addRow({ module: "TOTAL", ...reconciliation.totals });
  summary.getRow(1).font = { bold: true };
  const issueSheet = workbook.addWorksheet("Issues");
  issueSheet.columns = [
    { key: "severity", header: "级别", width: 12 }, { key: "sourceEntity", header: "源实体", width: 18 }, { key: "sourceId", header: "源ID", width: 24 },
    { key: "code", header: "代码", width: 40 }, { key: "field", header: "字段", width: 24 }, { key: "message", header: "说明", width: 80 },
  ];
  for (const value of issues) issueSheet.addRow({ ...value, sourceId: safeCell(value.sourceId), message: safeCell(value.message) });
  issueSheet.getRow(1).font = { bold: true };
  await workbook.xlsx.writeFile(xlsxPath);
  return { reconciliationJson: jsonPath, reconciliationXlsx: xlsxPath, issuesJson: issuesPath };
}
