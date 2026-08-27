import { createHash, randomUUID } from "node:crypto";
import { Prisma, type ReimbursementExpenseType, type ReimbursementStatus } from "@/generated/prisma/client";
import { authorizeActor } from "@/modules/permissions/authorization";
import type { PermissionActor } from "@/modules/permissions/types";
import { JobRepository } from "@/modules/jobs/job-repository";
import { OutboxRepository } from "@/modules/outbox/outbox-repository";
import type { ReimbursementEventType } from "@/modules/outbox/handlers/reimbursement-notification-handler";
import { writeReimbursementAudit, writeReimbursementTransition, type ReimbursementMutationContext } from "./audit";
import { ACTIVITY_EXPENSE_TYPES, EDITABLE_STATUSES, SUBSIDY_EXPENSE_TYPES, TRAVEL_EXPENSE_TYPES } from "./constants";
import { ReimbursementError, isSubmitIdempotencyUniqueConflict } from "./errors";
import { actorCanManageReimbursements, ReimbursementRepository, type ReimbursementTransaction } from "./repository/reimbursement-repository";
import { addInvoiceSchema, confirmInvoiceSchema, reasonSchema, reimbursementDraftSchema, stateCorrectionSchema } from "./schemas";
import { activeReimbursementManagers } from "./active-reimbursement-managers";

type Input = { actor: PermissionActor; context?: ReimbursementMutationContext };
type Draft = ReturnType<typeof reimbursementDraftSchema.parse>;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const normalizeInvoiceNo = (value: string | undefined) => value?.replace(/[^0-9A-Za-z]/g, "").toUpperCase() || null;
const json = (value: unknown) => JSON.parse(JSON.stringify(value, (_, item) =>
  item instanceof Date ? item.toISOString() : Prisma.Decimal.isDecimal(item) ? item.toString() : item,
)) as Prisma.InputJsonValue;

export function validateReimbursementExpenses(type: "TRAVEL" | "ACTIVITY", expenses: Draft["expenses"]) {
  const allowed = new Set<ReimbursementExpenseType>(type === "TRAVEL" ? TRAVEL_EXPENSE_TYPES : ACTIVITY_EXPENSE_TYPES);
  for (const expense of expenses) {
    if (!allowed.has(expense.expenseType)) throw new ReimbursementError("REIMBURSEMENT_EXPENSE_INVALID", "费用类型与报销类型不匹配");
    if (expense.expenseType === "OTHER" && !expense.customExpenseName) throw new ReimbursementError("REIMBURSEMENT_EXPENSE_INVALID", "其他费用必须填写费用名称");
    const subsidy = SUBSIDY_EXPENSE_TYPES.includes(expense.expenseType as typeof SUBSIDY_EXPENSE_TYPES[number]);
    if (subsidy) {
      const expectedRate = expense.expenseType === "TRAVEL_TRANSPORT_SUBSIDY" ? new Prisma.Decimal(80) : new Prisma.Decimal(100);
      if (expense.source !== "MANUAL" || !expense.referenceRate || !new Prisma.Decimal(expense.referenceRate).equals(expectedRate)) {
        throw new ReimbursementError("REIMBURSEMENT_EXPENSE_INVALID", "交通补贴仅可手工按 80 元、伙食补贴仅可手工按 100 元参考标准填写");
      }
      if (!expense.claimedDays || new Prisma.Decimal(expense.claimedDays).lte(0)) throw new ReimbursementError("REIMBURSEMENT_EXPENSE_INVALID", "补贴必须填写申报天数");
    } else if (expense.referenceRate || expense.claimedDays) {
      throw new ReimbursementError("REIMBURSEMENT_EXPENSE_INVALID", "非补贴费用不能填写补贴标准或天数");
    }
    if (new Prisma.Decimal(expense.amount).lte(0)) throw new ReimbursementError("REIMBURSEMENT_EXPENSE_INVALID", "费用金额必须大于 0");
  }
}

function stateSnapshot(value: { status: ReimbursementStatus; totalAmount: Prisma.Decimal; currentSubmissionVersionId: string | null }) {
  return { status: value.status, totalAmount: value.totalAmount.toString(), currentSubmissionVersionId: value.currentSubmissionVersionId };
}

function submitResponse(value: Prisma.JsonValue) {
  const record = value as Record<string, string | number>;
  return {
    id: String(record.id), businessNo: String(record.businessNo), status: String(record.status),
    submissionVersionId: String(record.submissionVersionId), versionNo: Number(record.versionNo), totalAmount: String(record.totalAmount),
  };
}

const CORRECTIONS: Record<string, readonly string[]> = {
  PENDING_ONLINE_REVIEW: ["RETURNED", "VERIFIED_PENDING_PAPER"], RETURNED: ["PENDING_ONLINE_REVIEW", "VERIFIED_PENDING_PAPER"],
  VERIFIED_PENDING_PAPER: ["RETURNED", "PAPER_RECEIVED"], PAPER_RECEIVED: ["VERIFIED_PENDING_PAPER", "FINANCE_SUBMITTED"],
  FINANCE_SUBMITTED: ["PAPER_RECEIVED", "VERIFIED_PENDING_PAPER"],
};

export class ReimbursementService {
  private readonly outbox = new OutboxRepository();
  constructor(private readonly repository = new ReimbursementRepository(), private readonly jobs = new JobRepository()) {}

  private async notify(tx: ReimbursementTransaction, item: { id: string; applicantPersonId: string }, eventType: ReimbursementEventType, eventKey: string, toState?: ReimbursementStatus) {
    const managerRecipientIds = await activeReimbursementManagers(tx);
    await this.outbox.append({
      eventType,
      aggregateType: "REIMBURSEMENT",
      aggregateId: item.id,
      payload: { reimbursementId: item.id, applicantPersonId: item.applicantPersonId, managerRecipientIds, eventKey, ...(toState ? { toState } : {}) },
      dedupeKey: `${eventType}:${item.id}:${eventKey}`,
    }, tx);
  }

  private async locked(tx: ReimbursementTransaction, id: string) {
    try { await this.repository.lock(tx, id); }
    catch (error) { if ((error as Error).message === "REIMBURSEMENT_LOCK_TARGET_NOT_FOUND") throw new ReimbursementError("REIMBURSEMENT_NOT_FOUND", "报销单不存在"); throw error; }
    const item = await this.repository.findById(tx, id);
    if (!item) throw new ReimbursementError("REIMBURSEMENT_NOT_FOUND", "报销单不存在");
    return item;
  }

  private ensureOwner(item: { applicantPersonId: string }, actor: PermissionActor) {
    if (item.applicantPersonId !== actor.personId) throw new ReimbursementError("REIMBURSEMENT_NOT_FOUND", "报销单不存在或无权查看");
  }

  private async decorateDetail(tx: ReimbursementTransaction, item: NonNullable<Awaited<ReturnType<ReimbursementRepository["findById"]>>>) {
    const [timeline, auditRecords] = await Promise.all([
      tx.stateTransitionHistory.findMany({ where: { entityType: "REIMBURSEMENT", entityId: item.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: { actorPerson: { select: { id: true, name: true } } } }),
      tx.auditLog.findMany({ where: { entityType: "REIMBURSEMENT", entityId: item.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, actionCode: true, reason: true, createdAt: true, actorPerson: { select: { id: true, name: true } } } }),
    ]);
    return { ...item, timeline, auditRecords };
  }

  private async validateTrip(tx: ReimbursementTransaction, tripId: string | null | undefined, personId: string) {
    if (!tripId) return null;
    const trip = await tx.trip.findFirst({ where: { id: tripId, canceledAt: null, result: { isNot: null }, participants: { some: { personId, leftAt: null } } },
      include: { result: true, nodes: { orderBy: { sequenceNo: "asc" }, select: { sequenceNo: true, plannedStartAt: true, plannedEndAt: true, locationName: true, address: true, content: true, enterprise: { select: { id: true, name: true } } } },
        participants: { where: { leftAt: null }, orderBy: { joinedAt: "asc" }, select: { person: { select: { id: true, name: true } } } } } });
    if (!trip?.result) throw new ReimbursementError("REIMBURSEMENT_TRIP_INVALID", "仅可关联本人实际参加且已完成的出行");
    return trip;
  }

  private async replaceExpenses(tx: ReimbursementTransaction, reimbursementId: string, type: "TRAVEL" | "ACTIVITY", expenses: Draft["expenses"]) {
    validateReimbursementExpenses(type, expenses);
    const invoiceIds = [...new Set(expenses.flatMap((e) => e.invoiceId ? [e.invoiceId] : []))];
    if (invoiceIds.length) {
      const invoices = await tx.reimbursementInvoice.findMany({ where: { id: { in: invoiceIds }, reimbursementId }, select: { id: true, ocrStatus: true } });
      if (invoices.length !== invoiceIds.length) throw new ReimbursementError("REIMBURSEMENT_INVOICE_INVALID", "费用引用了不属于该报销单的票据");
      const byId = new Map(invoices.map((invoice) => [invoice.id, invoice]));
      if (expenses.some((expense) => expense.source === "OCR" && (!expense.invoiceId || byId.get(expense.invoiceId)?.ocrStatus !== "CONFIRMED"))) {
        throw new ReimbursementError("REIMBURSEMENT_INVOICE_INVALID", "OCR 来源的费用必须引用已由申请人确认的票据");
      }
    } else if (expenses.some((expense) => expense.source === "OCR")) {
      throw new ReimbursementError("REIMBURSEMENT_INVOICE_INVALID", "OCR 来源的费用必须引用已确认票据");
    }
    await tx.reimbursementExpense.updateMany({ where: { reimbursementId, isActive: true }, data: { isActive: false } });
    if (expenses.length) await tx.reimbursementExpense.createMany({ data: expenses.map((expense) => ({
      reimbursementId, expenseType: expense.expenseType, customExpenseName: expense.customExpenseName,
      description: expense.description, expenseDate: expense.expenseDate, amount: new Prisma.Decimal(expense.amount),
      invoiceId: expense.invoiceId, source: expense.source,
      referenceRate: expense.referenceRate ? new Prisma.Decimal(expense.referenceRate) : undefined,
      claimedDays: expense.claimedDays ? new Prisma.Decimal(expense.claimedDays) : undefined,
      calculationNote: expense.calculationNote,
    })) });
    return expenses.reduce((sum, expense) => sum.plus(new Prisma.Decimal(expense.amount)), new Prisma.Decimal(0));
  }

  async create(input: Input & { body: unknown }) {
    await authorizeActor({ actor: input.actor, action: "reimbursement.create" });
    if (!input.actor.currentBatchMember && (!input.actor.effectiveRoles.includes("MEMBER_ALUMNI_PLATFORM") || !input.actor.specialPermissions.has("reimbursement.apply"))) {
      throw new ReimbursementError("REIMBURSEMENT_APPLICANT_INELIGIBLE", "仅当前团员或获专项授权的有效平台往届团员可发起报销");
    }
    const body = reimbursementDraftSchema.parse(input.body); validateReimbursementExpenses(body.type, body.expenses);
    return this.repository.transaction(async (tx) => {
      if (!await tx.person.count({ where: { id: input.actor.personId, personStatus: "ACTIVE", account: { is: { status: "NORMAL" } } } })) {
        throw new ReimbursementError("REIMBURSEMENT_APPLICANT_INELIGIBLE", "仅有效人员与正常账号可以发起报销");
      }
      await this.validateTrip(tx, body.linkedTripId, input.actor.personId);
      const businessNo = await this.repository.nextBusinessNo(tx);
      const item = await tx.reimbursement.create({ data: { businessNo, applicantPersonId: input.actor.personId, type: body.type, reason: body.reason, linkedTripId: body.linkedTripId ?? null } });
      const totalAmount = await this.replaceExpenses(tx, item.id, body.type, body.expenses);
      await tx.reimbursement.update({ where: { id: item.id }, data: { totalAmount } });
      await writeReimbursementTransition(tx, { ...input, entityId: item.id, actionCode: "REIMBURSEMENT_CREATED", toState: "DRAFT", metadata: { businessNo, type: body.type } });
      await writeReimbursementAudit(tx, { ...input, entityId: item.id, actionCode: "REIMBURSEMENT_CREATED", after: { businessNo, type: body.type, expenseCount: body.expenses.length } });
      return this.repository.findById(tx, item.id);
    });
  }

  async list(input: Input & { query: { mode: "mine" | "manage"; status?: ReimbursementStatus; type?: "TRAVEL" | "ACTIVITY"; page: number; pageSize: number } }) {
    if (input.query.mode === "manage") {
      if (!actorCanManageReimbursements(input.actor)) throw new ReimbursementError("REIMBURSEMENT_FORBIDDEN", "缺少报销管理权限");
    } else {
      await authorizeActor({ actor: input.actor, action: "reimbursement.view.self" });
    }
    return this.repository.list({ actor: input.actor, ...input.query });
  }

  async detail(input: Input & { reimbursementId: string }) {
    return this.repository.transaction(async (tx) => {
      const item = await this.repository.findVisible(tx, input.reimbursementId, input.actor);
      if (!item) throw new ReimbursementError("REIMBURSEMENT_NOT_FOUND", "报销单不存在或无权查看");
      return this.decorateDetail(tx, item);
    });
  }

  async eligibleTrips(input: Input) {
    await authorizeActor({ actor: input.actor, action: "reimbursement.view.self" });
    return this.repository.prisma.trip.findMany({ where: { canceledAt: null, result: { isNot: null }, participants: { some: { personId: input.actor.personId, leftAt: null } } },
      orderBy: { overallEndAt: "desc" }, take: 100, select: { id: true, title: true, overallEndAt: true } });
  }

  async update(input: Input & { reimbursementId: string; body: unknown }) {
    await authorizeActor({ actor: input.actor, action: "reimbursement.edit.self" });
    const body = reimbursementDraftSchema.parse(input.body); validateReimbursementExpenses(body.type, body.expenses);
    return this.repository.transaction(async (tx) => {
      const item = await this.locked(tx, input.reimbursementId); this.ensureOwner(item, input.actor);
      if (!EDITABLE_STATUSES.includes(item.status as typeof EDITABLE_STATUSES[number])) throw new ReimbursementError("REIMBURSEMENT_STATE_CONFLICT", "仅草稿或退回状态可编辑");
      await this.validateTrip(tx, body.linkedTripId, input.actor.personId);
      const totalAmount = await this.replaceExpenses(tx, item.id, body.type, body.expenses);
      await tx.reimbursement.update({ where: { id: item.id }, data: { type: body.type, reason: body.reason, linkedTripId: body.linkedTripId ?? null, totalAmount } });
      await writeReimbursementAudit(tx, { ...input, entityId: item.id, actionCode: "REIMBURSEMENT_UPDATED", before: { type: item.type, reason: item.reason }, after: { type: body.type, reason: body.reason, expenseCount: body.expenses.length } });
      return this.repository.findById(tx, item.id);
    });
  }

  async addInvoice(input: Input & { reimbursementId: string; body: unknown }) {
    await authorizeActor({ actor: input.actor, action: "reimbursement.edit.self" });
    const body = addInvoiceSchema.parse(input.body);
    return this.repository.transaction(async (tx) => {
      const item = await this.locked(tx, input.reimbursementId); this.ensureOwner(item, input.actor);
      if (!EDITABLE_STATUSES.includes(item.status as typeof EDITABLE_STATUSES[number])) throw new ReimbursementError("REIMBURSEMENT_STATE_CONFLICT", "当前状态不能添加票据");
      const rows = await tx.$queryRaw<Array<{ id: string; extension: string; uploadedByPersonId: string | null; isTemporary: boolean | number; uploadStatus: string; scanStatus: string; linkId: string | null }>>`
        SELECT a.id, a.uploaded_by_person_id AS uploadedByPersonId, a.is_temporary AS isTemporary,
          a.extension, a.upload_status AS uploadStatus, a.scan_status AS scanStatus, l.id AS linkId
        FROM attachments a LEFT JOIN attachment_links l ON l.attachment_id = a.id WHERE a.id = ${body.attachmentId} FOR UPDATE
      `;
      const file = rows[0];
      if (!file || rows.length !== 1 || file.uploadedByPersonId !== input.actor.personId || !(file.isTemporary === true || file.isTemporary === 1)
        || !["jpg", "jpeg", "png", "heic", "heif", "pdf", "ofd"].includes(file.extension)
        || file.linkId || file.uploadStatus !== "UPLOADED" || !["PENDING", "SCANNING", "PASSED"].includes(file.scanStatus)) {
        throw new ReimbursementError("REIMBURSEMENT_INVOICE_INVALID", "仅可添加本人已上传且等待扫描或扫描通过的临时票据");
      }
      const invoice = await tx.reimbursementInvoice.create({ data: { reimbursementId: item.id, attachmentId: body.attachmentId } });
      await tx.attachmentLink.create({ data: { attachmentId: body.attachmentId, entityType: "REIMBURSEMENT_INVOICE", entityId: item.id, relationType: "INVOICE", createdByPersonId: input.actor.personId } });
      await tx.attachment.update({ where: { id: body.attachmentId }, data: { isTemporary: false, permissionLevel: "SENSITIVE_PARENT" } });
      await writeReimbursementAudit(tx, { ...input, entityId: item.id, actionCode: "REIMBURSEMENT_INVOICE_ADDED", after: { invoiceId: invoice.id, attachmentId: body.attachmentId } });
      return invoice;
    });
  }

  async confirmInvoice(input: Input & { reimbursementId: string; invoiceId: string; body: unknown }) {
    await authorizeActor({ actor: input.actor, action: "reimbursement.edit.self" });
    const body = confirmInvoiceSchema.parse(input.body);
    return this.repository.transaction(async (tx) => {
      const item = await this.locked(tx, input.reimbursementId); this.ensureOwner(item, input.actor);
      if (!EDITABLE_STATUSES.includes(item.status as typeof EDITABLE_STATUSES[number])) throw new ReimbursementError("REIMBURSEMENT_STATE_CONFLICT", "当前状态不能确认票据");
      const invoice = await tx.reimbursementInvoice.findFirst({ where: { id: input.invoiceId, reimbursementId: item.id } });
      if (!invoice) throw new ReimbursementError("REIMBURSEMENT_INVOICE_INVALID", "票据不存在");
      if (invoice.ocrStatus === "CONFIRMED") return invoice;
      if (item.type === "TRAVEL" && !TRAVEL_EXPENSE_TYPES.includes(body.expenseType as typeof TRAVEL_EXPENSE_TYPES[number])) throw new ReimbursementError("REIMBURSEMENT_EXPENSE_INVALID", "出行报销票据只能归入四类出行费用");
      if (item.type === "ACTIVITY" && !ACTIVITY_EXPENSE_TYPES.includes(body.expenseType as typeof ACTIVITY_EXPENSE_TYPES[number])) throw new ReimbursementError("REIMBURSEMENT_EXPENSE_INVALID", "活动报销票据类型不正确");
      if (SUBSIDY_EXPENSE_TYPES.includes(body.expenseType as typeof SUBSIDY_EXPENSE_TYPES[number])) throw new ReimbursementError("REIMBURSEMENT_EXPENSE_INVALID", "交通和伙食补贴不得由 OCR 票据生成");
      if (["QUEUED", "PROCESSING"].includes(invoice.ocrStatus)) throw new ReimbursementError("REIMBURSEMENT_INVOICE_INVALID", "票据识别处理中，暂不能人工确认");
      if (!["NOT_REQUESTED", "READY", "DEGRADED", "FAILED"].includes(invoice.ocrStatus)) throw new ReimbursementError("REIMBURSEMENT_INVOICE_INVALID", "当前票据识别状态不能确认");
      if (item.type === "TRAVEL" && invoice.ocrWarning && /出租车|网约车|餐饮/.test(invoice.ocrWarning)) {
        throw new ReimbursementError("REIMBURSEMENT_EXPENSE_INVALID", "出租车、网约车或餐饮票据不能计入出行报销费用");
      }
      const normalized = normalizeInvoiceNo(body.invoiceNo);
      if (normalized && await tx.reimbursementInvoice.count({ where: { reimbursementId: item.id, invoiceNoNormalized: normalized, id: { not: invoice.id } } })) {
        throw new ReimbursementError("REIMBURSEMENT_DUPLICATE_INVOICE", "当前报销单内发票号码重复");
      }
      const updated = await tx.reimbursementInvoice.update({ where: { id: invoice.id }, data: { ocrStatus: "CONFIRMED", confirmedExpenseType: body.expenseType,
        confirmedInvoiceDate: body.invoiceDate, confirmedAmount: body.amount ? new Prisma.Decimal(body.amount) : null,
        confirmedSeller: body.seller ?? null, confirmedInvoiceNo: body.invoiceNo ?? null, invoiceNoNormalized: normalized,
        confirmedAt: new Date(), confirmedByPersonId: input.actor.personId } });
      await writeReimbursementAudit(tx, { ...input, entityId: item.id, actionCode: "REIMBURSEMENT_INVOICE_CONFIRMED", before: { invoiceId: invoice.id, ocrStatus: invoice.ocrStatus },
        after: { invoiceId: invoice.id, ocrStatus: updated.ocrStatus, expenseType: updated.confirmedExpenseType, invoiceNoNormalized: updated.invoiceNoNormalized } });
      return updated;
    });
  }

  async requestInvoiceOcr(input: Input & { reimbursementId: string; invoiceId: string }) {
    await authorizeActor({ actor: input.actor, action: "reimbursement.edit.self" });
    return this.repository.transaction(async (tx) => {
      const item = await this.locked(tx, input.reimbursementId); this.ensureOwner(item, input.actor);
      if (!EDITABLE_STATUSES.includes(item.status as typeof EDITABLE_STATUSES[number])) throw new ReimbursementError("REIMBURSEMENT_STATE_CONFLICT", "当前状态不能识别票据");
      const invoice = await tx.reimbursementInvoice.findFirst({ where: { id: input.invoiceId, reimbursementId: item.id }, include: { attachment: true } });
      if (!invoice || invoice.attachment.scanStatus !== "PASSED" || !invoice.attachment.objectKey) throw new ReimbursementError("REIMBURSEMENT_INVOICE_INVALID", "票据必须先上传完成并通过安全扫描");
      if (invoice.ocrStatus === "CONFIRMED") throw new ReimbursementError("REIMBURSEMENT_INVOICE_INVALID", "已人工确认的票据不能重新发起 OCR");
      if (["QUEUED", "PROCESSING"].includes(invoice.ocrStatus)) return invoice;
      await tx.reimbursementInvoice.update({ where: { id: invoice.id }, data: { ocrStatus: "QUEUED", ocrWarning: null } });
      await this.jobs.enqueue({ jobType: "REIMBURSEMENT_INVOICE_OCR", payload: { invoiceId: invoice.id },
        idempotencyKey: `reimbursement-ocr:${invoice.id}:${invoice.attachment.sha256 ?? invoice.attachment.id}:${invoice.updatedAt.getTime()}`, maxRetries: 3 }, tx);
      await writeReimbursementAudit(tx, { ...input, entityId: item.id, actionCode: "REIMBURSEMENT_OCR_REQUESTED", after: { invoiceId: invoice.id } });
      return { invoiceId: invoice.id, ocrStatus: "QUEUED" as const };
    });
  }

  async requestInvoiceOcrById(input: Input & { invoiceId: string }) {
    const invoice = await this.repository.prisma.reimbursementInvoice.findFirst({ where: { id: input.invoiceId, reimbursement: { applicantPersonId: input.actor.personId } }, select: { reimbursementId: true } });
    if (!invoice) throw new ReimbursementError("REIMBURSEMENT_NOT_FOUND", "票据不存在或无权访问");
    return this.requestInvoiceOcr({ ...input, reimbursementId: invoice.reimbursementId });
  }

  async confirmInvoiceById(input: Input & { invoiceId: string; body: unknown }) {
    const invoice = await this.repository.prisma.reimbursementInvoice.findFirst({ where: { id: input.invoiceId, reimbursement: { applicantPersonId: input.actor.personId } }, select: { reimbursementId: true } });
    if (!invoice) throw new ReimbursementError("REIMBURSEMENT_NOT_FOUND", "票据不存在或无权访问");
    return this.confirmInvoice({ ...input, reimbursementId: invoice.reimbursementId });
  }

  async submit(input: Input & { reimbursementId: string; idempotencyKey: string }) {
    await authorizeActor({ actor: input.actor, action: "reimbursement.submit" });
    const keyHash = hash(input.idempotencyKey); const payloadHash = hash(JSON.stringify({ reimbursementId: input.reimbursementId }));
    try {
      return await this.repository.transaction(async (tx) => {
        const item = await this.locked(tx, input.reimbursementId); this.ensureOwner(item, input.actor);
        const previous = await tx.reimbursementCommandIdempotency.findUnique({ where: { actorPersonId_idempotencyKeyHash: { actorPersonId: input.actor.personId, idempotencyKeyHash: keyHash } } });
        if (previous) {
          if (previous.reimbursementId !== item.id || previous.payloadHash !== payloadHash) throw new ReimbursementError("REIMBURSEMENT_IDEMPOTENCY_CONFLICT", "同一幂等键不能用于不同报销提交");
          return submitResponse(previous.responseJson);
        }
        if (!EDITABLE_STATUSES.includes(item.status as typeof EDITABLE_STATUSES[number])) throw new ReimbursementError("REIMBURSEMENT_STATE_CONFLICT", "仅草稿或退回状态可提交");
        if (!item.expenses.length) throw new ReimbursementError("REIMBURSEMENT_EXPENSE_INVALID", "至少填写一项费用后才能提交");
        const draftExpenses: Draft["expenses"] = item.expenses.map((e) => ({ expenseType: e.expenseType, customExpenseName: e.customExpenseName ?? undefined,
          description: e.description ?? undefined, expenseDate: e.expenseDate ?? undefined, amount: e.amount.toString(), invoiceId: e.invoiceId ?? undefined,
          source: e.source, referenceRate: e.referenceRate?.toString(), claimedDays: e.claimedDays?.toString(), calculationNote: e.calculationNote ?? undefined }));
        validateReimbursementExpenses(item.type, draftExpenses);
        if (await tx.reimbursementInvoice.count({ where: { reimbursementId: item.id, attachment: { is: { OR: [
          { uploadStatus: { not: "UPLOADED" } }, { scanStatus: { not: "PASSED" } }, { objectKey: null },
        ] } } } })) {
          throw new ReimbursementError("REIMBURSEMENT_INVOICE_INVALID", "所有票据必须上传完成并通过安全扫描后才能提交");
        }
        if (item.invoices.some((invoice) => ["QUEUED", "PROCESSING", "READY"].includes(invoice.ocrStatus))) throw new ReimbursementError("REIMBURSEMENT_INVOICE_INVALID", "请先确认或修正所有 OCR 识别结果");
        const numbers = item.invoices.flatMap((i) => i.invoiceNoNormalized ? [i.invoiceNoNormalized] : []).sort();
        if (new Set(numbers).size !== numbers.length) throw new ReimbursementError("REIMBURSEMENT_DUPLICATE_INVOICE", "当前报销单内发票号码重复");
        await this.repository.lockInvoiceNumbers(tx, numbers);
        if (numbers.length && await tx.reimbursementInvoice.count({ where: { invoiceNoNormalized: { in: numbers }, reimbursementId: { not: item.id }, reimbursement: { status: { notIn: ["DRAFT", "RETURNED"] } } } })) {
          throw new ReimbursementError("REIMBURSEMENT_DUPLICATE_INVOICE", "存在已提交报销单使用相同发票号码");
        }
        const trip = await this.validateTrip(tx, item.linkedTripId, input.actor.personId);
        const total = item.expenses.reduce((sum, expense) => sum.plus(expense.amount), new Prisma.Decimal(0));
        const maxVersion = await tx.reimbursementSubmissionVersion.aggregate({ where: { reimbursementId: item.id }, _max: { versionNo: true } });
        const now = new Date();
        const version = await tx.reimbursementSubmissionVersion.create({ data: { reimbursementId: item.id, versionNo: (maxVersion._max.versionNo ?? 0) + 1,
          reasonSnapshot: item.reason, tripSnapshotJson: trip ? json({ id: trip.id, title: trip.title, purpose: trip.purpose, overallEndAt: trip.overallEndAt, result: trip.result, nodes: trip.nodes, participants: trip.participants }) : undefined,
          expenseSnapshotJson: json(item.expenses), invoiceSnapshotJson: json(item.invoices.map(({ attachment, ...invoice }) => ({ ...invoice, attachment }))),
          totalAmount: total, submittedByPersonId: input.actor.personId, submittedAt: now } });
        const updated = await tx.reimbursement.update({ where: { id: item.id }, data: { status: "PENDING_ONLINE_REVIEW", totalAmount: total,
          currentSubmissionVersionId: version.id, firstSubmittedAt: item.firstSubmittedAt ?? now, lastSubmittedAt: now } });
        await writeReimbursementTransition(tx, { ...input, entityId: item.id, actionCode: "REIMBURSEMENT_SUBMITTED", fromState: item.status, toState: updated.status, metadata: { versionNo: version.versionNo, totalAmount: total.toString() } });
        await writeReimbursementAudit(tx, { ...input, entityId: item.id, actionCode: "REIMBURSEMENT_SUBMITTED", before: stateSnapshot(item), after: stateSnapshot(updated) });
        const response = { id: item.id, businessNo: item.businessNo, status: updated.status, submissionVersionId: version.id, versionNo: version.versionNo, totalAmount: total.toString() };
        await this.notify(tx, item, "REIMBURSEMENT_SUBMITTED", version.id, updated.status);
        await tx.reimbursementCommandIdempotency.create({ data: { reimbursementId: item.id, actorPersonId: input.actor.personId, idempotencyKeyHash: keyHash, payloadHash, responseJson: response } });
        return response;
      });
    } catch (error) {
      if (!isSubmitIdempotencyUniqueConflict(error)) throw error;
      const previous = await this.repository.findSubmitIdempotency({ actorPersonId: input.actor.personId, idempotencyKeyHash: keyHash });
      if (!previous) throw error;
      if (previous.reimbursementId !== input.reimbursementId || previous.payloadHash !== payloadHash) throw new ReimbursementError("REIMBURSEMENT_IDEMPOTENCY_CONFLICT", "同一幂等键不能用于不同报销提交");
      return submitResponse(previous.responseJson);
    }
  }

  async withdraw(input: Input & { reimbursementId: string }) {
    await authorizeActor({ actor: input.actor, action: "reimbursement.withdraw" });
    return this.transition(input, input.reimbursementId, "PENDING_ONLINE_REVIEW", "DRAFT", "REIMBURSEMENT_WITHDRAWN", false);
  }

  private async requireManager(actor: PermissionActor, action: "reimbursement.manage.review" | "reimbursement.manage.return" | "reimbursement.manage.paper_received" | "reimbursement.manage.finance_submitted" | "reimbursement.manage.correct") {
    await authorizeActor({ actor, action, resource: { resourceType: "reimbursement", requiredScope: "REIMBURSEMENT_AUTHORIZED" } });
  }

  private async transition(input: Input, id: string, from: ReimbursementStatus, to: ReimbursementStatus, actionCode: ReimbursementEventType, manager: boolean, reason?: string) {
    if (manager && !actorCanManageReimbursements(input.actor)) throw new ReimbursementError("REIMBURSEMENT_FORBIDDEN", "缺少报销管理权限");
    return this.repository.transaction(async (tx) => {
      const item = await this.locked(tx, id); if (!manager) this.ensureOwner(item, input.actor);
      if (item.status !== from) throw new ReimbursementError("REIMBURSEMENT_STATE_CONFLICT", `仅 ${from} 状态可执行此操作`);
      const now = new Date();
      const updated = await tx.reimbursement.update({ where: { id }, data: { status: to,
        ...(to === "PAPER_RECEIVED" && item.paperReceivedAt === null ? { paperReceivedAt: now, paperReceivedByPersonId: input.actor.personId } : {}),
        ...(to === "FINANCE_SUBMITTED" && item.financeSubmittedAt === null ? { financeSubmittedAt: now, financeSubmittedByPersonId: input.actor.personId } : {}) } });
      await writeReimbursementTransition(tx, { ...input, entityId: id, actionCode, fromState: from, toState: to, reason });
      await writeReimbursementAudit(tx, { ...input, entityId: id, actionCode, before: stateSnapshot(item), after: stateSnapshot(updated), reason });
      await this.notify(tx, item, actionCode, randomUUID(), to);
      return this.repository.findById(tx, id);
    });
  }

  async returnForRevision(input: Input & { reimbursementId: string; body: unknown }) {
    await this.requireManager(input.actor, "reimbursement.manage.return"); const { reason } = reasonSchema.parse(input.body);
    return this.repository.transaction(async (tx) => {
      const item = await this.locked(tx, input.reimbursementId);
      if (!["PENDING_ONLINE_REVIEW", "VERIFIED_PENDING_PAPER"].includes(item.status)) throw new ReimbursementError("REIMBURSEMENT_STATE_CONFLICT", "仅待线上核对或已核对待纸质材料状态可退回");
      const updated = await tx.reimbursement.update({ where: { id: item.id }, data: { status: "RETURNED" } });
      await writeReimbursementTransition(tx, { ...input, entityId: item.id, actionCode: "REIMBURSEMENT_RETURNED", fromState: item.status, toState: "RETURNED", reason });
      await writeReimbursementAudit(tx, { ...input, entityId: item.id, actionCode: "REIMBURSEMENT_RETURNED", before: stateSnapshot(item), after: stateSnapshot(updated), reason });
      await this.notify(tx, item, "REIMBURSEMENT_RETURNED", randomUUID(), "RETURNED");
      return this.repository.findById(tx, item.id);
    });
  }
  async verify(input: Input & { reimbursementId: string }) { await this.requireManager(input.actor, "reimbursement.manage.review"); return this.transition(input, input.reimbursementId, "PENDING_ONLINE_REVIEW", "VERIFIED_PENDING_PAPER", "REIMBURSEMENT_VERIFIED", true); }
  async paperReceived(input: Input & { reimbursementId: string }) { await this.requireManager(input.actor, "reimbursement.manage.paper_received"); return this.transition(input, input.reimbursementId, "VERIFIED_PENDING_PAPER", "PAPER_RECEIVED", "REIMBURSEMENT_PAPER_RECEIVED", true); }
  async paperIncomplete(input: Input & { reimbursementId: string; body: unknown }) { await this.requireManager(input.actor, "reimbursement.manage.paper_received"); const { reason } = reasonSchema.parse(input.body); return this.transition(input, input.reimbursementId, "PAPER_RECEIVED", "VERIFIED_PENDING_PAPER", "REIMBURSEMENT_PAPER_INCOMPLETE", true, reason); }
  async financeSubmitted(input: Input & { reimbursementId: string }) { await this.requireManager(input.actor, "reimbursement.manage.finance_submitted"); return this.transition(input, input.reimbursementId, "PAPER_RECEIVED", "FINANCE_SUBMITTED", "REIMBURSEMENT_FINANCE_SUBMITTED", true); }

  async correctState(input: Input & { reimbursementId: string; body: unknown }) {
    await this.requireManager(input.actor, "reimbursement.manage.correct"); const body = stateCorrectionSchema.parse(input.body);
    if (!CORRECTIONS[body.fromState]?.includes(body.toState)) throw new ReimbursementError("REIMBURSEMENT_CORRECTION_INVALID", "不允许该状态纠正路径");
    return this.repository.transaction(async (tx) => {
      const item = await this.locked(tx, input.reimbursementId);
      if (item.status !== body.fromState) throw new ReimbursementError("REIMBURSEMENT_STATE_CONFLICT", "报销单状态已变化");
      const now = new Date();
      const updated = await tx.reimbursement.update({ where: { id: item.id }, data: {
        status: body.toState,
        ...(body.toState === "PAPER_RECEIVED" && item.paperReceivedAt === null ? { paperReceivedAt: now, paperReceivedByPersonId: input.actor.personId } : {}),
        ...(body.toState === "FINANCE_SUBMITTED" && item.financeSubmittedAt === null ? { financeSubmittedAt: now, financeSubmittedByPersonId: input.actor.personId } : {}),
      } });
      await writeReimbursementTransition(tx, { ...input, entityId: item.id, actionCode: "REIMBURSEMENT_STATE_CORRECTED", fromState: body.fromState, toState: body.toState, reason: body.reason });
      await writeReimbursementAudit(tx, { ...input, entityId: item.id, actionCode: "REIMBURSEMENT_STATE_CORRECTED", before: stateSnapshot(item), after: stateSnapshot(updated), reason: body.reason });
      await this.notify(tx, item, "REIMBURSEMENT_STATE_CORRECTED", randomUUID(), body.toState);
      return this.repository.findById(tx, item.id);
    });
  }
}
