import { createHash, randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RoleCode } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { getAttachmentRuntime } from "@/modules/attachment/runtime";
import { DataExportService } from "@/modules/import-export/export-service";
import { ImportService } from "@/modules/import-export/import-service";
import { resolveCapabilities, type PermissionActor } from "@/modules/permissions";

process.env.APP_ENV = "test";

const prisma = getPrismaClient();
const importService = new ImportService();
const exportService = new DataExportService();
const personIds: string[] = []; const accountIds: string[] = []; const areaIds: string[] = []; const batchIds: string[] = []; const attachmentIds: string[] = [];
const importedPhones: string[] = []; const enterpriseIds: string[] = [];
let admin: PermissionActor; let township: PermissionActor; let areaA: string; let areaB: string; let memberBatchId: string; let memberBatchName: string;

async function actor(role: RoleCode, areas: string[] = []): Promise<PermissionActor> {
  const person = await prisma.person.create({ data: { name: `M3-005 ${role} ${randomUUID()}` } }); personIds.push(person.id);
  const account = await prisma.account.create({ data: { personId: person.id, phone: `137${Math.floor(10_000_000 + Math.random() * 89_999_999)}`, passwordHash: "db-test", status: "NORMAL" } }); accountIds.push(account.id);
  const roles = [role]; return { personId: person.id, accountId: account.id, accountStatus: "NORMAL", permissionVersion: BigInt(1), effectiveRoles: roles,
    capabilities: resolveCapabilities(roles, new Set()), specialPermissions: new Set(), selfPersonId: person.id,
    townshipAreaIds: role === "TOWNSHIP_STAFF" ? areas : [], departmentAreaIds: role === "DEPARTMENT_STAFF" ? areas : [],
    hasGlobalPublished: true, hasGlobalOperational: role === "ADMIN" || role === "SUPER_ADMIN", hasSystem: role === "SUPER_ADMIN", currentBatchMember: false, configurationIssues: [] };
}

async function workbook(headers: string[], rows: string[][]) { const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet("导入"); sheet.addRow(headers); rows.forEach((row) => sheet.addRow(row)); return Buffer.from(await book.xlsx.writeBuffer()); }

async function sourceAttachment(owner: PermissionActor, body: Buffer, filename: string) {
  const id = randomUUID(); const objectKey = `test/imports/${id}.xlsx`; const runtime = getAttachmentRuntime();
  await runtime.storage.writeObject(objectKey, body, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  await prisma.attachment.create({ data: { id, originalFilename: filename, extension: "xlsx", declaredMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    detectedMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", detectedFileType: "xlsx", expectedSizeBytes: BigInt(body.length), actualSizeBytes: BigInt(body.length),
    sha256: createHash("sha256").update(body).digest("hex"), bucket: runtime.storage.bucket, region: runtime.storage.region, objectKey, uploadStatus: "UPLOADED", scanStatus: "PASSED",
    isTemporary: true, permissionLevel: "SENSITIVE_PARENT", uploadedByPersonId: owner.personId } }); attachmentIds.push(id); return id;
}

async function createBatch(type: "ENTERPRISE" | "MEMBER" | "TALENT", body: Buffer, name: string) {
  const attachmentId = await sourceAttachment(admin, body, name); const created = await importService.create({ actor: admin, body: { importType: type, sourceAttachmentId: attachmentId } });
  batchIds.push(created.id); return created;
}

beforeAll(async () => {
  const suffix = randomUUID().slice(0, 8); areaA = (await prisma.administrativeArea.create({ data: { name: `M3甲镇-${suffix}`, type: "TOWNSHIP" } })).id;
  areaB = (await prisma.administrativeArea.create({ data: { name: `M3乙镇-${suffix}`, type: "TOWNSHIP" } })).id; areaIds.push(areaA, areaB);
  [admin, township] = await Promise.all([actor("ADMIN"), actor("TOWNSHIP_STAFF", [areaA])]);
  const createdBatch = await prisma.batch.create({ data: { name: `M3批次-${suffix}`, year: 2026, startDate: new Date("2026-01-01"), status: "ACTIVE" } });
  memberBatchId = createdBatch.id; memberBatchName = createdBatch.name;
});

afterAll(async () => {
  const importedPeople = await prisma.person.findMany({ where: { contactPhone: { in: importedPhones } }, select: { id: true, account: { select: { id: true } } } });
  const allPeople = [...personIds, ...importedPeople.map(({ id }) => id)]; const allAccounts = [...accountIds, ...importedPeople.flatMap(({ account }) => account ? [account.id] : [])];
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorPersonId: { in: allPeople } }, { actorAccountId: { in: allAccounts } }, { entityType: { in: ["IMPORT_BATCH", "IMPORT_ROW", "ENTERPRISE_EXPORT", "TALENT_EXPORT"] } }] } });
  await prisma.stateTransitionHistory.deleteMany({ where: { actorPersonId: { in: allPeople } } });
  await prisma.importApplySnapshot.deleteMany({ where: { batchId: { in: batchIds } } }); await prisma.importCommandIdempotency.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.importRow.deleteMany({ where: { batchId: { in: batchIds } } }); await prisma.attachmentLink.deleteMany({ where: { attachmentId: { in: attachmentIds } } });
  await prisma.importBatch.deleteMany({ where: { id: { in: batchIds } } }); await prisma.attachment.deleteMany({ where: { id: { in: attachmentIds } } });
  const importedEnterpriseIds = (await prisma.enterprise.findMany({ where: { OR: [{ id: { in: enterpriseIds } }, { createdByPersonId: admin.personId }] }, select: { id: true } })).map(({ id }) => id);
  await prisma.enterprise.updateMany({ where: { id: { in: importedEnterpriseIds } }, data: { primaryContactId: null } }); await prisma.enterpriseContact.deleteMany({ where: { enterpriseId: { in: importedEnterpriseIds } } });
  await prisma.enterpriseVersion.deleteMany({ where: { enterpriseId: { in: importedEnterpriseIds } } }); await prisma.enterpriseTagRelation.deleteMany({ where: { enterpriseId: { in: importedEnterpriseIds } } });
  await prisma.enterprise.deleteMany({ where: { id: { in: importedEnterpriseIds } } });
  await prisma.memberCapabilityIndustry.deleteMany({ where: { personId: { in: importedPeople.map(({ id }) => id) } } }); await prisma.memberPreferredDemandType.deleteMany({ where: { personId: { in: importedPeople.map(({ id }) => id) } } });
  await prisma.memberCapabilityProfile.deleteMany({ where: { personId: { in: importedPeople.map(({ id }) => id) } } }); await prisma.roleAssignment.deleteMany({ where: { personId: { in: importedPeople.map(({ id }) => id) } } });
  await prisma.batchMembership.deleteMany({ where: { personId: { in: importedPeople.map(({ id }) => id) } } }); await prisma.account.deleteMany({ where: { id: { in: allAccounts } } });
  await prisma.person.deleteMany({ where: { id: { in: allPeople } } }); await prisma.batch.delete({ where: { id: memberBatchId } }); await prisma.administrativeArea.deleteMany({ where: { id: { in: areaIds } } }); await prisma.$disconnect();
});

describe("M3-005 real MySQL atomic import", () => {
  it("applies an enterprise batch once and replays concurrent same-key confirmation", async () => {
    const credit = `91321023${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
    const body = await workbook(["企业名称", "信用代码", "镇区", "地址", "主营产品", "联系人", "联系人电话"], [["M3原子企业", credit, (await prisma.administrativeArea.findUniqueOrThrow({ where: { id: areaA } })).name, "测试路1号", "装备", "联系人甲", "13800009101"]]);
    const batch = await createBatch("ENTERPRISE", body, "enterprise.xlsx"); expect(batch.status).toBe("PREVIEW_READY"); expect(batch.blockingRowCount).toBe(0);
    const key = randomUUID(); const results = await Promise.all([1, 2].map(() => importService.confirm({ actor: admin, batchId: batch.id, body: { confirm: true, expectedPreviewVersion: batch.previewVersion }, idempotencyKey: key })));
    expect(results[0]).toEqual(results[1]); const enterprise = await prisma.enterprise.findUniqueOrThrow({ where: { creditCode: credit } }); enterpriseIds.push(enterprise.id);
    expect(await prisma.enterprise.count({ where: { creditCode: credit } })).toBe(1); expect(await prisma.enterpriseVersion.count({ where: { enterpriseId: enterprise.id } })).toBe(1);
    expect(await prisma.importApplySnapshot.count({ where: { batchId: batch.id, createdEntityId: enterprise.id } })).toBe(1);

    const otherCredit = `91321023${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
    const conflictingBatch = await createBatch("ENTERPRISE", await workbook(["企业名称", "信用代码", "镇区", "地址", "主营产品"], [["M3幂等冲突企业", otherCredit, (await prisma.administrativeArea.findUniqueOrThrow({ where: { id: areaA } })).name, "测试路2号", "装备"]]), "idempotency-conflict.xlsx");
    await expect(importService.confirm({ actor: admin, batchId: conflictingBatch.id, body: { confirm: true, expectedPreviewVersion: conflictingBatch.previewVersion }, idempotencyKey: key })).rejects.toMatchObject({ code: "IMPORT_IDEMPOTENCY_CONFLICT" });
    expect(await prisma.enterprise.count({ where: { creditCode: otherCredit } })).toBe(0);
    expect(await prisma.importBatch.findUniqueOrThrow({ where: { id: conflictingBatch.id } })).toMatchObject({ status: "PREVIEW_READY" });
  });

  it("rejects an old preview after mapping is regenerated", async () => {
    const credit = `91321023${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
    const headers = ["企业名称", "信用代码", "镇区", "地址", "主营产品"];
    const batch = await createBatch("ENTERPRISE", await workbook(headers, [["M3映射竞态企业", credit, (await prisma.administrativeArea.findUniqueOrThrow({ where: { id: areaA } })).name, "测试路3号", "装备"]]), "mapping-race.xlsx");
    const oldPreviewVersion = batch.previewVersion;
    const refreshed = await importService.updateMapping({ actor: admin, batchId: batch.id, body: {
      sheetName: "导入",
      columns: headers.map((sourceHeader, index) => ({ sourceColumn: index + 1, sourceHeader, targetField: ["name", "creditCode", "responsibleArea", "address", "mainProducts"][index] })),
    } });
    expect(refreshed.previewVersion).toBeGreaterThan(oldPreviewVersion);
    await expect(importService.confirm({ actor: admin, batchId: batch.id, body: { confirm: true, expectedPreviewVersion: oldPreviewVersion }, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "IMPORT_PREVIEW_STALE" });
    expect(await prisma.enterprise.count({ where: { creditCode: credit } })).toBe(0);
  });

  it("rolls back earlier rows when a late unique race is detected", async () => {
    const shared = `91321023${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`; const unique = `91321023${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
    const areaName = (await prisma.administrativeArea.findUniqueOrThrow({ where: { id: areaA } })).name;
    const winner = await createBatch("ENTERPRISE", await workbook(["企业名称", "信用代码", "镇区", "地址", "主营产品"], [["共享企业", shared, areaName, "地址", "产品"]]), "winner.xlsx");
    const loser = await createBatch("ENTERPRISE", await workbook(["企业名称", "信用代码", "镇区", "地址", "主营产品"], [["应回滚企业", unique, areaName, "地址", "产品"], ["共享企业冲突", shared, areaName, "地址", "产品"]]), "loser.xlsx");
    await importService.confirm({ actor: admin, batchId: winner.id, body: { confirm: true, expectedPreviewVersion: winner.previewVersion }, idempotencyKey: randomUUID() });
    await expect(importService.confirm({ actor: admin, batchId: loser.id, body: { confirm: true, expectedPreviewVersion: loser.previewVersion }, idempotencyKey: randomUUID() })).rejects.toBeTruthy();
    const existing = await prisma.enterprise.findUniqueOrThrow({ where: { creditCode: shared } }); enterpriseIds.push(existing.id);
    expect(await prisma.enterprise.count({ where: { creditCode: unique } })).toBe(0); expect(await prisma.importApplySnapshot.count({ where: { batchId: loser.id } })).toBe(0);
    expect(await prisma.importBatch.findUniqueOrThrow({ where: { id: loser.id } })).toMatchObject({ status: "FAILED" });
  });

  it("preserves existing accounts and leaves historical alumni without accounts", async () => {
    const existingPhone = `136${Math.floor(10_000_000 + Math.random() * 89_999_999)}`; const historicalPhone = `135${Math.floor(10_000_000 + Math.random() * 89_999_999)}`; importedPhones.push(existingPhone, historicalPhone);
    const existingPerson = await prisma.person.create({ data: { name: "M3已有成员", contactPhone: existingPhone } });
    const existingAccount = await prisma.account.create({ data: { personId: existingPerson.id, phone: existingPhone, passwordHash: "must-not-change", status: "DISABLED" } });
    const body = await workbook(["姓名", "手机号", "批次", "成员类型", "开始日期", "创建账号"], [["M3已有成员", existingPhone, memberBatchName, "在任", "2026-01-01", "是"], ["M3历史往届", historicalPhone, memberBatchName, "历史往届", "2026-01-01", "否"]]);
    const batch = await createBatch("MEMBER", body, "members.xlsx"); expect(batch.blockingRowCount).toBe(0);
    await importService.confirm({ actor: admin, batchId: batch.id, body: { confirm: true, expectedPreviewVersion: batch.previewVersion }, idempotencyKey: randomUUID() });
    expect(await prisma.account.findUniqueOrThrow({ where: { id: existingAccount.id } })).toMatchObject({ passwordHash: "must-not-change", status: "DISABLED" });
    const historical = await prisma.person.findFirstOrThrow({ where: { contactPhone: historicalPhone } }); expect(await prisma.account.count({ where: { personId: historical.id } })).toBe(0);
  });

  it("lets exactly one member batch win a late phone race and rolls back the loser", async () => {
    const phone = `134${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    importedPhones.push(phone);
    const memberRows = [["M3手机号竞态", phone, memberBatchName, "在任", "2026-01-01", "是"]];
    const [first, second] = await Promise.all([
      createBatch("MEMBER", await workbook(["姓名", "手机号", "批次", "成员类型", "开始日期", "创建账号"], memberRows), "member-race-a.xlsx"),
      createBatch("MEMBER", await workbook(["姓名", "手机号", "批次", "成员类型", "开始日期", "创建账号"], memberRows), "member-race-b.xlsx"),
    ]);
    expect(first.blockingRowCount).toBe(0);
    expect(second.blockingRowCount).toBe(0);

    const settled = await Promise.allSettled([
      importService.confirm({ actor: admin, batchId: first.id, body: { confirm: true, expectedPreviewVersion: first.previewVersion }, idempotencyKey: randomUUID() }),
      importService.confirm({ actor: admin, batchId: second.id, body: { confirm: true, expectedPreviewVersion: second.previewVersion }, idempotencyKey: randomUUID() }),
    ]);
    expect(settled.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(settled.filter(({ status }) => status === "rejected")).toHaveLength(1);
    const person = await prisma.person.findFirstOrThrow({ where: { contactPhone: phone } });
    expect(await prisma.person.count({ where: { contactPhone: phone } })).toBe(1);
    expect(await prisma.account.count({ where: { phone, personId: person.id } })).toBe(1);
    expect(await prisma.batchMembership.count({ where: { personId: person.id, batchId: memberBatchId } })).toBe(1);
    expect(await prisma.importApplySnapshot.count({ where: { batchId: { in: [first.id, second.id] }, createdEntityId: person.id } })).toBe(1);
    const statuses = await prisma.importBatch.findMany({ where: { id: { in: [first.id, second.id] } }, select: { status: true } });
    expect(statuses.map(({ status }) => status).sort()).toEqual(["FAILED", "SUCCEEDED"]);
  });
});

describe("M3-005 scoped export", () => {
  it("exports only the township's current effective area", async () => {
    const foreign = await prisma.enterprise.create({ data: { name: "M3范围外企业", responsibleAreaId: areaB, address: "地址", mainProducts: "产品", createdByPersonId: admin.personId } }); enterpriseIds.push(foreign.id);
    const own = await prisma.enterprise.create({ data: { name: "M3范围内企业", responsibleAreaId: areaA, address: "地址", mainProducts: "产品", createdByPersonId: admin.personId } }); enterpriseIds.push(own.id);
    const exported = await exportService.enterprise({ actor: township, body: {} }); const book = new ExcelJS.Workbook(); await book.xlsx.load(exported.buffer as never); const sheet = book.worksheets[0];
    const names: string[] = []; sheet.eachRow((row, number) => { if (number > 1) names.push(String(row.getCell(1).value ?? "")); });
    expect(names).toContain("M3范围内企业"); expect(names).not.toContain("M3范围外企业");
  });
});
