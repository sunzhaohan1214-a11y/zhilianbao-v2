import { Prisma, type ReimbursementStatus, type ReimbursementType } from "@/generated/prisma/client";

export async function createReimbursementFromLegacyInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    actorPersonId: string;
    actorAccountId?: string;
    applicantPersonId: string;
    businessNo: string;
    sourceSystem: string;
    sourceId: string;
    type: ReimbursementType;
    reason: string;
    status: ReimbursementStatus;
    totalAmount: string;
    snapshotAt: Date;
  },
) {
  const reimbursement = await tx.reimbursement.create({
    data: {
      businessNo: input.businessNo,
      applicantPersonId: input.applicantPersonId,
      type: input.type,
      reason: input.reason,
      status: input.status,
      totalAmount: new Prisma.Decimal(input.totalAmount),
      firstSubmittedAt: input.snapshotAt,
      lastSubmittedAt: input.snapshotAt,
      sourceSystem: input.sourceSystem,
      sourceRecordId: input.sourceId,
    },
  });
  const version = await tx.reimbursementSubmissionVersion.create({
    data: {
      reimbursementId: reimbursement.id,
      versionNo: 1,
      reasonSnapshot: input.reason,
      expenseSnapshotJson: [],
      invoiceSnapshotJson: [],
      totalAmount: new Prisma.Decimal(input.totalAmount),
      submittedByPersonId: input.applicantPersonId,
      submittedAt: input.snapshotAt,
    },
  });
  await tx.reimbursement.update({
    where: { id: reimbursement.id },
    data: { currentSubmissionVersionId: version.id },
  });
  await tx.stateTransitionHistory.create({
    data: {
      entityType: "REIMBURSEMENT",
      entityId: reimbursement.id,
      toState: input.status,
      actionCode: "REIMBURSEMENT_IMPORTED_FROM_V1",
      actorPersonId: input.actorPersonId,
      metadataJson: { sourceSystem: input.sourceSystem, sourceId: input.sourceId },
    },
  });
  await tx.auditLog.create({
    data: {
      actorPersonId: input.actorPersonId,
      actorAccountId: input.actorAccountId,
      actionCode: "REIMBURSEMENT_IMPORTED_FROM_V1",
      entityType: "REIMBURSEMENT",
      entityId: reimbursement.id,
      afterJson: { sourceSystem: input.sourceSystem, sourceId: input.sourceId, status: input.status },
      reason: "V1 migration",
    },
  });
  return reimbursement;
}
