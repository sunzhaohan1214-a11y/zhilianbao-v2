import { Prisma, type DemandStatus, type DemandType } from "@/generated/prisma/client";

type Tx = Prisma.TransactionClient;

type LegacyProgress = {
  sourceId: string;
  content: string;
  occurredAt: Date;
  actorPersonId: string;
};

export async function createDemandFromLegacyInTransaction(
  tx: Tx,
  input: {
    actorPersonId: string;
    actorAccountId?: string;
    businessNo: string;
    sourceSystem: string;
    sourceId: string;
    sourceSnapshot: Prisma.InputJsonValue;
    snapshotAt: Date;
    title: string;
    description: string;
    demandType: DemandType;
    status: DemandStatus;
    enterpriseId: string;
    responsibleAreaId: string;
    selectedContactId: string;
    contactSnapshot: { enterpriseName: string; contactName: string; contactPhone: string };
    batchId: string;
    ownerPersonId?: string;
    completedAt?: Date;
    progresses: LegacyProgress[];
  },
) {
  const demand = await tx.demand.create({
    data: {
      businessNo: input.businessNo,
      enterpriseId: input.enterpriseId,
      responsibleAreaId: input.responsibleAreaId,
      selectedContactId: input.selectedContactId,
      title: input.title,
      originalDescription: input.description,
      demandType: input.demandType,
      status: input.status,
      creationBatchId: input.batchId,
      currentFollowBatchId: input.batchId,
      firstPublishedAt: input.snapshotAt,
      currentOwnerPersonId: input.ownerPersonId,
      completedAt: input.completedAt,
      completionBatchId: input.completedAt ? input.batchId : undefined,
      createdByPersonId: input.actorPersonId,
    },
  });
  await tx.demandProvenance.create({
    data: {
      demandId: demand.id,
      sourceType: "V1_MIGRATION",
      sourceSnapshot: input.sourceSnapshot,
    },
  });
  await tx.demandContactSnapshot.create({
    data: {
      demandId: demand.id,
      enterpriseName: input.contactSnapshot.enterpriseName,
      contactName: input.contactSnapshot.contactName,
      contactPhone: input.contactSnapshot.contactPhone,
      snapshotAt: input.snapshotAt,
    },
  });
  if (input.ownerPersonId) {
    await tx.demandOwnerHistory.create({
      data: {
        demandId: demand.id,
        personId: input.ownerPersonId,
        batchId: input.batchId,
        effectiveAt: input.snapshotAt,
        changeType: "CLAIM",
        reason: "V1 历史主责迁移",
        createdByPersonId: input.actorPersonId,
      },
    });
  }
  const progresses = [];
  for (const progress of input.progresses) {
    progresses.push(await tx.demandProgress.create({
      data: {
        demandId: demand.id,
        currentProgress: progress.content,
        nextStep: "历史迁移记录，无可靠下一步",
        createdByPersonId: progress.actorPersonId,
        sourceType: "CURRENT_OWNER",
        createdAt: progress.occurredAt,
      },
    }));
  }
  await tx.stateTransitionHistory.create({
    data: {
      entityType: "DEMAND",
      entityId: demand.id,
      toState: input.status,
      actionCode: "DEMAND_IMPORTED_FROM_V1",
      actorPersonId: input.actorPersonId,
      metadataJson: { sourceSystem: input.sourceSystem, sourceId: input.sourceId },
    },
  });
  await tx.auditLog.create({
    data: {
      actorPersonId: input.actorPersonId,
      actorAccountId: input.actorAccountId,
      actionCode: "DEMAND_IMPORTED_FROM_V1",
      entityType: "DEMAND",
      entityId: demand.id,
      afterJson: { sourceSystem: input.sourceSystem, sourceId: input.sourceId, status: input.status },
      reason: "V1 migration",
    },
  });
  return { demand, progresses };
}
