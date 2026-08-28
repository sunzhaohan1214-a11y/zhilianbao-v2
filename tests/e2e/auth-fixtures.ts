import { getPrismaClient } from "@/lib/db/prisma";
import { hashPassword, initialPasswordFromPhone } from "@/modules/identity/password/password";

export const e2eUsers = {
  unactivated: { personId: "10000000-0000-4000-8000-000000000001", accountId: "20000000-0000-4000-8000-000000000001", phone: "13800001001", password: "001001" },
  normal: { personId: "10000000-0000-4000-8000-000000000002", accountId: "20000000-0000-4000-8000-000000000002", phone: "13800001002", password: "Normal-pass-123" },
  admin: { personId: "10000000-0000-4000-8000-000000000003", accountId: "20000000-0000-4000-8000-000000000003", phone: "13800001003", password: "Admin-pass-123" },
  forced: { personId: "10000000-0000-4000-8000-000000000004", accountId: "20000000-0000-4000-8000-000000000004", phone: "13800001004", password: "001004" },
  minister: { personId: "10000000-0000-4000-8000-000000000005", accountId: "20000000-0000-4000-8000-000000000005", phone: "13800001005", password: "Minister-pass-123" },
  groupLeader: { personId: "10000000-0000-4000-8000-000000000006", accountId: "20000000-0000-4000-8000-000000000006", phone: "13800001006", password: "Leader-pass-123" },
  superAdmin: { personId: "10000000-0000-4000-8000-000000000007", accountId: "20000000-0000-4000-8000-000000000007", phone: "13800001007", password: "Super-pass-123" },
  township: { personId: "10000000-0000-4000-8000-000000000008", accountId: "20000000-0000-4000-8000-000000000008", phone: "13800001008", password: "Township-pass-123" },
  alumni: { personId: "10000000-0000-4000-8000-000000000009", accountId: "20000000-0000-4000-8000-000000000009", phone: "13800001009", password: "Alumni-pass-123" },
  disabled: { personId: "10000000-0000-4000-8000-000000000010", accountId: "20000000-0000-4000-8000-000000000010", phone: "13800001010", password: "Disabled-pass-123" },
  department: { personId: "10000000-0000-4000-8000-000000000011", accountId: "20000000-0000-4000-8000-000000000011", phone: "13800001011", password: "Department-pass-123" },
  ministerOnly: { personId: "10000000-0000-4000-8000-000000000012", accountId: "20000000-0000-4000-8000-000000000012", phone: "13800001012", password: "Minister-only-pass-123" },
  township2: { personId: "10000000-0000-4000-8000-000000000014", accountId: "20000000-0000-4000-8000-000000000014", phone: "13800001014", password: "Township2-pass-123" },
} as const;

export const enterpriseE2e = {
  areaAId: "30000000-0000-4000-8000-000000000001",
  areaBId: "30000000-0000-4000-8000-000000000002",
  organizationId: "40000000-0000-4000-8000-000000000001",
  dispatchOrganizationId: "40000000-0000-4000-8000-000000000002",
  departmentOrganizationId: "40000000-0000-4000-8000-000000000003",
  organizationBId: "40000000-0000-4000-8000-000000000004",
  batchId: "50000000-0000-4000-8000-000000000001",
  enterpriseId: "60000000-0000-4000-8000-000000000001",
  enterprise2Id: "60000000-0000-4000-8000-000000000002",
  enterprise3Id: "60000000-0000-4000-8000-000000000003",
  contactId: "70000000-0000-4000-8000-000000000001",
  pastBatchId: "50000000-0000-4000-8000-000000000002",
  industryId: "80000000-0000-4000-8000-000000000001",
  presenceId: "80000000-0000-4000-8000-000000000001",
} as const;

export const policyE2e = {
  oldPolicyId: "90000000-0000-4000-8000-000000000001",
  oldVersionId: "90000000-0000-4000-8000-000000000002",
  oldAttachmentId: "90000000-0000-4000-8000-000000000003",
  tagId: "90000000-0000-4000-8000-000000000004",
} as const;

export const talentE2e = {
  talentId: "91000000-0000-4000-8000-000000000001",
  versionId: "91000000-0000-4000-8000-000000000002",
  contactHistoryId: "91000000-0000-4000-8000-000000000003",
  resumeAttachmentId: "91000000-0000-4000-8000-000000000004",
} as const;

export async function seedAuthFixtures() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!/test/i.test(databaseUrl)) throw new Error("E2E auth fixtures require an explicitly named test database");
  const prisma = getPrismaClient();
  const users = Object.values(e2eUsers);
  const importBatches = await prisma.importBatch.findMany({
    where: { createdByPersonId: { in: users.map(({ personId }) => personId) } },
    select: { id: true, sourceAttachmentId: true },
  });
  const importBatchIds = importBatches.map(({ id }) => id);
  const importAttachmentIds = importBatches.map(({ sourceAttachmentId }) => sourceAttachmentId);
  const importedPersonIds = (await prisma.importApplySnapshot.findMany({
    where: { batchId: { in: importBatchIds }, entityType: "PERSON", createdEntityId: { not: null } },
    select: { createdEntityId: true },
  })).flatMap(({ createdEntityId }) => createdEntityId ? [createdEntityId] : [])
    .filter((personId) => !users.some((user) => user.personId === personId));
  await prisma.importApplySnapshot.deleteMany({ where: { batchId: { in: importBatchIds } } });
  await prisma.importCommandIdempotency.deleteMany({ where: { batchId: { in: importBatchIds } } });
  await prisma.importRow.deleteMany({ where: { batchId: { in: importBatchIds } } });
  await prisma.attachmentLink.deleteMany({ where: { entityType: "IMPORT_BATCH", entityId: { in: importBatchIds } } });
  await prisma.importBatch.deleteMany({ where: { id: { in: importBatchIds } } });
  await prisma.attachmentAccessLog.deleteMany({ where: { attachmentId: { in: importAttachmentIds } } });
  await prisma.jobTask.deleteMany({ where: { idempotencyKey: { in: importAttachmentIds.map((id) => `attachment-scan:${id}`) } } });
  await prisma.attachment.deleteMany({ where: { id: { in: importAttachmentIds } } });
  await prisma.memberCapabilityIndustry.deleteMany({ where: { personId: { in: importedPersonIds } } });
  await prisma.memberPreferredDemandType.deleteMany({ where: { personId: { in: importedPersonIds } } });
  await prisma.memberCapabilityProfile.deleteMany({ where: { personId: { in: importedPersonIds } } });
  await prisma.roleAssignment.deleteMany({ where: { personId: { in: importedPersonIds } } });
  await prisma.batchMembership.deleteMany({ where: { personId: { in: importedPersonIds } } });
  const importedAccountIds = (await prisma.account.findMany({ where: { personId: { in: importedPersonIds } }, select: { id: true } })).map(({ id }) => id);
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorPersonId: { in: importedPersonIds } }, { actorAccountId: { in: importedAccountIds } }] } });
  await prisma.account.deleteMany({ where: { personId: { in: importedPersonIds } } });
  await prisma.person.deleteMany({ where: { id: { in: importedPersonIds } } });
  const helpIds = (await prisma.helpRequest.findMany({ where: { submitterPersonId: { in: users.map(({ personId }) => personId) } }, select: { id: true } })).map(({ id }) => id);
  const helpProgressIds = (await prisma.helpProgress.findMany({ where: { helpRequestId: { in: helpIds } }, select: { id: true } })).map(({ id }) => id);
  const helpAttachmentIds = (await prisma.attachmentLink.findMany({ where: { OR: [{ entityType: "HELP_REQUEST", entityId: { in: helpIds } }, { entityType: "HELP_PROGRESS", entityId: { in: helpProgressIds } }] }, select: { attachmentId: true } })).map(({ attachmentId }) => attachmentId);
  await prisma.attachmentLink.deleteMany({ where: { OR: [{ entityType: "HELP_REQUEST", entityId: { in: helpIds } }, { entityType: "HELP_PROGRESS", entityId: { in: helpProgressIds } }] } });
  await prisma.helpCommandIdempotency.deleteMany({ where: { helpRequestId: { in: helpIds } } });
  await prisma.helpProgress.deleteMany({ where: { helpRequestId: { in: helpIds } } });
  await prisma.helpAssignmentHistory.deleteMany({ where: { helpRequestId: { in: helpIds } } });
  await prisma.helpRequest.deleteMany({ where: { id: { in: helpIds } } });
  await prisma.attachmentAccessLog.deleteMany({ where: { attachmentId: { in: helpAttachmentIds } } });
  await prisma.attachment.deleteMany({ where: { id: { in: helpAttachmentIds } } });
  const policyRecords = await prisma.policy.findMany({ where: { createdByPersonId: { in: users.map(({ personId }) => personId) } }, select: { id: true, versions: { select: { id: true } } } });
  const policyIds = policyRecords.map(({ id }) => id); const policyVersionIds = policyRecords.flatMap(({ versions }) => versions.map(({ id }) => id));
  const policyAttachmentIds = (await prisma.attachmentLink.findMany({ where: { entityType: "POLICY_CONTENT_VERSION", entityId: { in: policyVersionIds } }, select: { attachmentId: true } })).map(({ attachmentId }) => attachmentId);
  await prisma.policy.updateMany({ where: { id: { in: policyIds } }, data: { currentVersionId: null } });
  await prisma.attachmentLink.deleteMany({ where: { entityType: "POLICY_CONTENT_VERSION", entityId: { in: policyVersionIds } } });
  await prisma.policyAIInterpretation.deleteMany({ where: { versionId: { in: policyVersionIds } } });
  await prisma.policyReplacementRelation.deleteMany({ where: { OR: [{ oldPolicyId: { in: policyIds } }, { newPolicyId: { in: policyIds } }] } });
  await prisma.policyTagRelation.deleteMany({ where: { policyId: { in: policyIds } } });
  await prisma.policyContentVersion.deleteMany({ where: { id: { in: policyVersionIds } } });
  await prisma.policy.deleteMany({ where: { id: { in: policyIds } } });
  await prisma.attachmentAccessLog.deleteMany({ where: { attachmentId: { in: policyAttachmentIds } } });
  await prisma.attachment.deleteMany({ where: { id: { in: policyAttachmentIds } } });
  const e2eLeadIds = (await prisma.demandLead.findMany({
    where: {
      OR: [
        { responsibleAreaId: { in: [enterpriseE2e.areaAId, enterpriseE2e.areaBId] } },
        { createdByPersonId: { in: users.map(({ personId }) => personId) } },
      ],
    },
    select: { id: true },
  })).map(({ id }) => id);
  const e2eDemandIds = (await prisma.demand.findMany({
    where: {
      OR: [
        { createdByPersonId: { in: users.map(({ personId }) => personId) } },
        { provenances: { some: { demandLeadId: { in: e2eLeadIds } } } },
      ],
    },
    select: { id: true },
  })).map(({ id }) => id);
  const e2eProgressIds = (await prisma.demandProgress.findMany({ where: { demandId: { in: e2eDemandIds } }, select: { id: true } })).map(({ id }) => id);
  const e2eCloseRequestIds = (await prisma.demandCloseRequest.findMany({ where: { demandId: { in: e2eDemandIds } }, select: { id: true } })).map(({ id }) => id);
  const e2eOutcomePlans = await prisma.demandOutcomePlan.findMany({ where: { demandId: { in: e2eDemandIds } }, select: { id: true } });
  const e2eOutcomePlanIds = e2eOutcomePlans.map(({ id }) => id);
  const e2eOutcomeRoundIds = (await prisma.demandOutcomeRound.findMany({ where: { demandId: { in: e2eDemandIds } }, select: { id: true } })).map(({ id }) => id);
  const e2eLifecycleAttachmentIds = (await prisma.attachmentLink.findMany({ where: { OR: [
    { entityType: "DEMAND_PROGRESS", entityId: { in: e2eProgressIds } },
    { entityType: "DEMAND_CLOSE_REQUEST", entityId: { in: e2eCloseRequestIds } },
    { entityType: "DEMAND_OUTCOME_ROUND", entityId: { in: e2eOutcomeRoundIds } },
  ] }, select: { attachmentId: true } })).map(({ attachmentId }) => attachmentId);
  await prisma.todo.deleteMany({ where: { aggregateType: "DEMAND", aggregateId: { in: e2eDemandIds } } });
  await prisma.message.deleteMany({ where: { aggregateType: "DEMAND", aggregateId: { in: e2eDemandIds } } });
  await prisma.outboxEvent.deleteMany({ where: { aggregateType: "DEMAND", aggregateId: { in: e2eDemandIds } } });
  await prisma.demand.updateMany({ where: { id: { in: e2eDemandIds } }, data: { status: "RETURNED", currentOwnerPersonId: null } });
  await prisma.attachmentLink.deleteMany({ where: { OR: [
    { entityType: "DEMAND_PROGRESS", entityId: { in: e2eProgressIds } },
    { entityType: "DEMAND_CLOSE_REQUEST", entityId: { in: e2eCloseRequestIds } },
    { entityType: "DEMAND_OUTCOME_ROUND", entityId: { in: e2eOutcomeRoundIds } },
  ] } });
  await prisma.demandCloseReview.deleteMany({ where: { demandId: { in: e2eDemandIds } } });
  await prisma.demandProgressReminder.deleteMany({ where: { demandId: { in: e2eDemandIds } } });
  await prisma.demandOwnerExitRequest.deleteMany({ where: { demandId: { in: e2eDemandIds } } });
  await prisma.demandProgress.deleteMany({ where: { demandId: { in: e2eDemandIds } } });
  await prisma.demandCloseRequest.deleteMany({ where: { demandId: { in: e2eDemandIds } } });
  await prisma.jobTask.deleteMany({ where: { jobType: "DEMAND_OUTCOME_DUE", idempotencyKey: { startsWith: "demand-outcome-due:" } } });
  await prisma.demandOutcomeRound.deleteMany({ where: { id: { in: e2eOutcomeRoundIds } } });
  await prisma.demandOutcomePlan.deleteMany({ where: { id: { in: e2eOutcomePlanIds } } });
  await prisma.attachmentAccessLog.deleteMany({ where: { attachmentId: { in: e2eLifecycleAttachmentIds } } });
  await prisma.attachment.deleteMany({ where: { id: { in: e2eLifecycleAttachmentIds } } });
  await prisma.demandAlumniHelper.deleteMany({ where: { demandId: { in: e2eDemandIds } } });
  await prisma.demandTownshipHandler.deleteMany({ where: { demandId: { in: e2eDemandIds } } });
  await prisma.demandRecommendationItem.deleteMany({ where: { run: { demandId: { in: e2eDemandIds } } } });
  await prisma.demandRecommendationRun.deleteMany({ where: { demandId: { in: e2eDemandIds } } });
  await prisma.jobTask.deleteMany({ where: { jobType: "DEMAND_RECOMMENDATION_RUN" } });
  await prisma.attachmentLink.deleteMany({ where: { entityType: "DEMAND", entityId: { in: e2eDemandIds } } });
  await prisma.demandCommandIdempotency.deleteMany({ where: { demandId: { in: e2eDemandIds } } });
  await prisma.demandCollaborator.deleteMany({ where: { demandId: { in: e2eDemandIds } } });
  await prisma.demandCollaborationRequest.deleteMany({ where: { demandId: { in: e2eDemandIds } } });
  await prisma.demandOwnerHistory.deleteMany({ where: { demandId: { in: e2eDemandIds } } });
  await prisma.demandReview.deleteMany({ where: { demandId: { in: e2eDemandIds } } });
  await prisma.demandContactSnapshot.deleteMany({ where: { demandId: { in: e2eDemandIds } } });
  await prisma.demandProvenance.deleteMany({ where: { OR: [{ demandId: { in: e2eDemandIds } }, { demandLeadId: { in: e2eLeadIds } }] } });
  await prisma.demandLead.updateMany({ where: { id: { in: e2eLeadIds } }, data: { mergedIntoLeadId: null, convertedDemandId: null } });
  await prisma.demand.deleteMany({ where: { id: { in: e2eDemandIds } } });
  await prisma.visitDemandLeadIdempotency.deleteMany({ where: { demandLeadId: { in: e2eLeadIds } } });
  await prisma.demandLeadPublicIdempotency.deleteMany({ where: { demandLeadId: { in: e2eLeadIds } } });
  await prisma.demandLeadSupplement.deleteMany({ where: { demandLeadId: { in: e2eLeadIds } } });
  await prisma.demandLead.deleteMany({ where: { id: { in: e2eLeadIds } } });
  const e2eTrips = await prisma.trip.findMany({
    where: { createdByPersonId: { in: users.map(({ personId }) => personId) } },
    select: { id: true, visits: { select: { id: true } } },
  });
  const e2eTripIds = e2eTrips.map(({ id }) => id);
  const e2eVisitIds = e2eTrips.flatMap(({ visits }) => visits.map(({ id }) => id));
  await prisma.attachmentLink.deleteMany({ where: { OR: [
    { entityType: "TRIP", entityId: { in: e2eTripIds } },
    { entityType: "ENTERPRISE_VISIT", entityId: { in: e2eVisitIds } },
  ] } });
  await prisma.visitDemandLeadIdempotency.deleteMany({ where: { visitId: { in: e2eVisitIds } } });
  await prisma.tripIdempotency.deleteMany({ where: { tripId: { in: e2eTripIds } } });
  await prisma.visitSupplement.deleteMany({ where: { visitId: { in: e2eVisitIds } } });
  await prisma.enterpriseVisit.deleteMany({ where: { id: { in: e2eVisitIds } } });
  await prisma.tripResult.deleteMany({ where: { tripId: { in: e2eTripIds } } });
  await prisma.tripNode.deleteMany({ where: { tripId: { in: e2eTripIds } } });
  await prisma.tripParticipant.deleteMany({ where: { tripId: { in: e2eTripIds } } });
  await prisma.trip.deleteMany({ where: { id: { in: e2eTripIds } } });
  const enterpriseWhere = { createdByPersonId: { in: users.map(({ personId }) => personId) } };
  const talentIds = (await prisma.talent.findMany({ where: { OR: [{ createdByPersonId: { in: users.map(({ personId }) => personId) } }, { id: talentE2e.talentId }] }, select: { id: true } })).map(({ id }) => id);
  const talentVersionIds = (await prisma.talentVersion.findMany({ where: { talentId: { in: talentIds } }, select: { id: true } })).map(({ id }) => id);
  const talentRequestIds = (await prisma.talentChangeRequest.findMany({ where: { OR: [{ submitterPersonId: { in: users.map(({ personId }) => personId) } }, { approvedTalentId: { in: talentIds } }] }, select: { id: true } })).map(({ id }) => id);
  const talentRoundIds = (await prisma.talentTownshipRound.findMany({ where: { talentId: { in: talentIds } }, select: { id: true } })).map(({ id }) => id);
  await prisma.attachmentLink.deleteMany({ where: { OR: [{ entityType: "TALENT_VERSION", entityId: { in: talentVersionIds } }, { entityType: "TALENT_CHANGE_REQUEST", entityId: { in: talentRequestIds } }] } });
  await prisma.talentAIExtraction.deleteMany({ where: { requestId: { in: talentRequestIds } } });
  await prisma.talentTownshipProgress.deleteMany({ where: { roundId: { in: talentRoundIds } } });
  await prisma.talentTownshipRound.deleteMany({ where: { id: { in: talentRoundIds } } });
  await prisma.talentContactPersonHistory.deleteMany({ where: { talentId: { in: talentIds } } });
  await prisma.talentVersion.deleteMany({ where: { id: { in: talentVersionIds } } });
  await prisma.talentChangeRequest.deleteMany({ where: { id: { in: talentRequestIds } } });
  await prisma.attachmentAccessLog.deleteMany({ where: { attachmentId: talentE2e.resumeAttachmentId } });
  await prisma.attachment.deleteMany({ where: { id: talentE2e.resumeAttachmentId } });
  await prisma.talent.updateMany({ where: { id: { in: talentIds } }, data: { status: "DISABLED", mergedIntoId: null } });
  await prisma.talent.deleteMany({ where: { id: { in: talentIds } } });
  await prisma.presenceReport.deleteMany({ where: { personId: { in: users.map(({ personId }) => personId) } } });
  await prisma.enterprise.updateMany({ where: enterpriseWhere, data: { status: "NORMAL", mergedIntoId: null, primaryContactId: null } });
  await prisma.enterpriseChangeRequest.deleteMany({ where: { OR: [{ submitterPersonId: { in: users.map(({ personId }) => personId) } }, { reviewerPersonId: { in: users.map(({ personId }) => personId) } }] } });
  await prisma.enterpriseVersion.deleteMany({ where: { enterprise: enterpriseWhere } });
  await prisma.enterpriseTagRelation.deleteMany({ where: { enterprise: enterpriseWhere } });
  await prisma.enterpriseContact.deleteMany({ where: { enterprise: enterpriseWhere } });
  await prisma.enterprise.deleteMany({ where: enterpriseWhere });
  await prisma.stateTransitionHistory.deleteMany({ where: { actorPersonId: { in: users.map(({ personId }) => personId) } } });
  await prisma.auditLog.deleteMany({ where: { actorAccountId: { in: users.map(({ accountId }) => accountId) } } });
  await prisma.mapBoundaryVersion.deleteMany({ where: { createdByPersonId: { in: users.map(({ personId }) => personId) } } });
  await prisma.memberCapabilityIndustry.deleteMany({ where: { personId: { in: users.map(({ personId }) => personId) } } });
  await prisma.memberPreferredDemandType.deleteMany({ where: { personId: { in: users.map(({ personId }) => personId) } } });
  await prisma.memberCapabilityProfile.deleteMany({ where: { personId: { in: users.map(({ personId }) => personId) } } });
  await prisma.groupLeaderAssignment.deleteMany({ where: { OR: [{ personId: { in: users.map(({ personId }) => personId) } }, { grantedByPersonId: { in: users.map(({ personId }) => personId) } }] } });
  await prisma.specialPermissionGrant.deleteMany({ where: { OR: [{ personId: { in: users.map(({ personId }) => personId) } }, { grantedByPersonId: { in: users.map(({ personId }) => personId) } }] } });
  await prisma.batchMembership.deleteMany({ where: { personId: { in: users.map(({ personId }) => personId) } } });
  await prisma.batch.deleteMany({ where: { name: "E2E 延任批次", id: { notIn: [enterpriseE2e.batchId, enterpriseE2e.pastBatchId] } } });
  await prisma.appointment.deleteMany({ where: { personId: { in: users.map(({ personId }) => personId) } } });
  await prisma.session.deleteMany({ where: { accountId: { in: users.map(({ accountId }) => accountId) } } });
  await prisma.authRateLimitBucket.deleteMany();

  for (const [name, fixture] of Object.entries(e2eUsers)) {
    await prisma.person.upsert({
      where: { id: fixture.personId },
      create: { id: fixture.personId, name: `E2E ${name}` },
      update: { name: `E2E ${name}` },
    });
    const isUnactivated = name === "unactivated";
    const isForced = name === "forced";
    const isDisabled = name === "disabled";
    const password = isUnactivated || isForced ? initialPasswordFromPhone(fixture.phone) : fixture.password;
    await prisma.account.upsert({
      where: { id: fixture.accountId },
      create: {
        id: fixture.accountId,
        personId: fixture.personId,
        phone: fixture.phone,
        passwordHash: await hashPassword(password),
        status: isUnactivated ? "UNACTIVATED" : isDisabled ? "DISABLED" : "NORMAL",
        forcePasswordChange: isForced,
        firstPasswordChangedAt: isUnactivated ? null : new Date(),
        confidentialityConfirmedAt: isUnactivated ? null : new Date(),
      },
      update: {
        phone: fixture.phone,
        passwordHash: await hashPassword(password),
        status: isUnactivated ? "UNACTIVATED" : isDisabled ? "DISABLED" : "NORMAL",
        forcePasswordChange: isForced,
        firstPasswordChangedAt: isUnactivated ? null : new Date(),
        confidentialityConfirmedAt: isUnactivated ? null : new Date(),
        permissionVersion: 1,
      },
    });
  }
  await prisma.roleAssignment.deleteMany({ where: { personId: { in: users.map(({ personId }) => personId) } } });
  await prisma.roleAssignment.createMany({
    data: [
      { personId: e2eUsers.admin.personId, roleCode: "ADMIN" as const },
      { personId: e2eUsers.admin.personId, roleCode: "TOWNSHIP_STAFF" as const },
      { personId: e2eUsers.minister.personId, roleCode: "MINISTER" as const },
      { personId: e2eUsers.minister.personId, roleCode: "MEMBER_CURRENT" as const },
      { personId: e2eUsers.groupLeader.personId, roleCode: "GROUP_LEADER" as const },
      { personId: e2eUsers.groupLeader.personId, roleCode: "MEMBER_CURRENT" as const },
      { personId: e2eUsers.superAdmin.personId, roleCode: "SUPER_ADMIN" as const },
      { personId: e2eUsers.normal.personId, roleCode: "MEMBER_CURRENT" as const },
      { personId: e2eUsers.township.personId, roleCode: "TOWNSHIP_STAFF" as const },
      { personId: e2eUsers.township2.personId, roleCode: "TOWNSHIP_STAFF" as const },
      { personId: e2eUsers.alumni.personId, roleCode: "MEMBER_ALUMNI_PLATFORM" as const },
      { personId: e2eUsers.department.personId, roleCode: "DEPARTMENT_STAFF" as const },
      { personId: e2eUsers.ministerOnly.personId, roleCode: "MINISTER" as const },
    ].map(({ personId, roleCode }) => ({
      personId,
      roleCode,
      effectiveAt: new Date(Date.now() - 60_000),
      grantedByPersonId: e2eUsers.superAdmin.personId,
      reason: "M0-004 unified permission E2E fixture",
    })),
  });

  await prisma.batch.updateMany({ where: { isCurrent: true, id: { not: enterpriseE2e.batchId } }, data: { isCurrent: false } });
  await prisma.batch.upsert({
    where: { id: enterpriseE2e.batchId },
    create: { id: enterpriseE2e.batchId, name: "E2E current batch", year: 2026, startDate: new Date("2026-01-01"), endDate: new Date("2027-01-01"), status: "ACTIVE", isCurrent: true },
    update: { status: "ACTIVE", isCurrent: true },
  });
  await prisma.batch.upsert({ where: { id: enterpriseE2e.pastBatchId }, create: { id: enterpriseE2e.pastBatchId, name: "E2E historical batch", year: 2025, startDate: new Date("2025-01-01"), endDate: new Date("2025-12-31"), status: "CLOSED", isCurrent: false }, update: { status: "CLOSED", isCurrent: false } });
  await prisma.organization.upsert({ where: { id: enterpriseE2e.dispatchOrganizationId }, create: { id: enterpriseE2e.dispatchOrganizationId, name: "E2E 派出单位", type: "DISPATCH_UNIT", address: "TEST ONLY", latitude: 32.0603, longitude: 118.7969 }, update: { name: "E2E 派出单位", type: "DISPATCH_UNIT", status: "ACTIVE", address: "TEST ONLY", latitude: 32.0603, longitude: 118.7969 } });
  await prisma.batchMembership.createMany({ data: [
    ...[e2eUsers.normal, e2eUsers.minister, e2eUsers.groupLeader].map((fixture) => ({ personId: fixture.personId, batchId: enterpriseE2e.batchId, dispatchOrganizationId: enterpriseE2e.dispatchOrganizationId, startDate: new Date("2026-01-01"), endDate: new Date("2027-01-01"), status: "ACTIVE" })),
    { personId: e2eUsers.admin.personId, batchId: enterpriseE2e.pastBatchId, startDate: new Date("2025-01-01"), endDate: new Date("2025-12-31"), status: "COMPLETED" },
    { personId: e2eUsers.alumni.personId, batchId: enterpriseE2e.batchId, startDate: new Date("2025-01-01"), endDate: new Date("2025-12-31"), status: "INACTIVE" },
  ] });
  await prisma.groupLeaderAssignment.create({ data: { personId: e2eUsers.groupLeader.personId, batchId: enterpriseE2e.batchId, effectiveAt: new Date("2026-01-01"), grantedByPersonId: e2eUsers.superAdmin.personId, reason: "E2E current group leader" } });
  await prisma.memberIndustry.upsert({ where: { id: enterpriseE2e.industryId }, create: { id: enterpriseE2e.industryId, name: "智能制造" }, update: { name: "智能制造", status: "ACTIVE" } });
  await prisma.presenceReport.upsert({
    where: { id: enterpriseE2e.presenceId },
    create: { id: enterpriseE2e.presenceId, personId: e2eUsers.alumni.personId, arrivalAt: new Date("2026-09-12T01:00:00Z"), expectedDepartureAt: new Date("2026-09-12T10:00:00Z"), note: "E2E 往届历史种子" },
    update: { personId: e2eUsers.alumni.personId, arrivalAt: new Date("2026-09-12T01:00:00Z"), expectedDepartureAt: new Date("2026-09-12T10:00:00Z"), note: "E2E 往届历史种子", origin: null, canceledAt: null, cancelReason: null },
  });
  for (const [id, name] of [[enterpriseE2e.areaAId, "安宜镇"], [enterpriseE2e.areaBId, "射阳湖镇"]] as const) {
    await prisma.administrativeArea.upsert({ where: { id }, create: { id, name, type: "TOWNSHIP" }, update: { name, status: "ACTIVE" } });
  }
  await prisma.organization.upsert({ where: { id: enterpriseE2e.organizationId }, create: { id: enterpriseE2e.organizationId, name: "E2E 安宜镇", type: "TOWNSHIP_ORG" }, update: { status: "ACTIVE" } });
  await prisma.organization.upsert({ where: { id: enterpriseE2e.departmentOrganizationId }, create: { id: enterpriseE2e.departmentOrganizationId, name: "E2E 县级部门", type: "DEPARTMENT" }, update: { name: "E2E 县级部门", type: "DEPARTMENT", status: "ACTIVE" } });
  await prisma.organization.upsert({ where: { id: enterpriseE2e.organizationBId }, create: { id: enterpriseE2e.organizationBId, name: "E2E 射阳湖镇", type: "TOWNSHIP_ORG" }, update: { status: "ACTIVE" } });
  const mapping = await prisma.organizationAreaMapping.findFirst({ where: { organizationId: enterpriseE2e.organizationId, areaId: enterpriseE2e.areaAId, expiredAt: null } });
  if (!mapping) await prisma.organizationAreaMapping.create({ data: { organizationId: enterpriseE2e.organizationId, areaId: enterpriseE2e.areaAId, effectiveAt: new Date("2026-01-01") } });
  await prisma.departmentTownshipRelation.deleteMany({ where: { departmentOrganizationId: enterpriseE2e.departmentOrganizationId } });
  await prisma.departmentTownshipRelation.create({ data: { departmentOrganizationId: enterpriseE2e.departmentOrganizationId, areaId: enterpriseE2e.areaAId, effectiveAt: new Date("2026-01-01") } });
  await prisma.appointment.createMany({ data: [
    { personId: e2eUsers.township.personId, organizationId: enterpriseE2e.organizationId, positionTitle: "企业服务专员", effectiveAt: new Date("2026-01-01") },
    { personId: e2eUsers.township2.personId, organizationId: enterpriseE2e.organizationId, positionTitle: "求助服务专员", effectiveAt: new Date("2026-01-01") },
    { personId: e2eUsers.normal.personId, organizationId: enterpriseE2e.organizationId, positionTitle: "挂职专员", effectiveAt: new Date("2026-01-01") },
    { personId: e2eUsers.groupLeader.personId, organizationId: enterpriseE2e.organizationBId, positionTitle: "其他镇街专员", effectiveAt: new Date("2026-01-01") },
    { personId: e2eUsers.admin.personId, organizationId: enterpriseE2e.organizationId, positionTitle: "管理员兼镇区服务专员", effectiveAt: new Date("2026-01-01") },
    { personId: e2eUsers.department.personId, organizationId: enterpriseE2e.departmentOrganizationId, positionTitle: "部门工作人员", effectiveAt: new Date("2026-01-01") },
  ] });
  await prisma.enterprise.create({ data: { id: enterpriseE2e.enterpriseId, name: "宝应智造示范企业", responsibleAreaId: enterpriseE2e.areaAId, address: "宝应县安宜镇测试大道1号", creditCode: "91321023E2ETEST001", mainProducts: "智能装备、工业软件与技术服务", introduction: "用于 M1-001 关键链路验收。", createdByPersonId: e2eUsers.admin.personId } });
  await prisma.enterpriseContact.create({ data: { id: enterpriseE2e.contactId, enterpriseId: enterpriseE2e.enterpriseId, name: "王经理", positionTitle: "企业联系人", phone: "13800003001", isPrimary: true, createdByPersonId: e2eUsers.admin.personId } });
  await prisma.enterprise.update({ where: { id: enterpriseE2e.enterpriseId }, data: { primaryContactId: enterpriseE2e.contactId } });
  await prisma.enterpriseVersion.create({ data: { enterpriseId: enterpriseE2e.enterpriseId, versionNo: 1, snapshotJson: { name: "宝应智造示范企业", currentVersion: 1 }, changeType: "CREATE", changedByPersonId: e2eUsers.admin.personId } });
  await prisma.talent.create({ data: { id: talentE2e.talentId, name: "E2E 智能制造专家", scopeType: "DOMESTIC", organizationName: "宝应人才测试院", title: "首席研究员", professionalDirection: "智能制造与工业软件", workEducationExperience: "长期从事智能制造研究。", representativeAchievements: "获得多项发明专利。", originalRecommenderPersonId: e2eUsers.normal.personId, currentContactPersonId: e2eUsers.normal.personId, createdByPersonId: e2eUsers.admin.personId } });
  await prisma.talentVersion.create({ data: { id: talentE2e.versionId, talentId: talentE2e.talentId, versionNo: 1, snapshotJson: { name: "E2E 智能制造专家", currentVersion: 1 }, changeType: "CREATE", changedByPersonId: e2eUsers.admin.personId } });
  await prisma.talentContactPersonHistory.create({ data: { id: talentE2e.contactHistoryId, talentId: talentE2e.talentId, personId: e2eUsers.normal.personId, effectiveAt: new Date("2026-01-01"), changedByPersonId: e2eUsers.admin.personId } });
  await prisma.policyTag.upsert({ where: { id: policyE2e.tagId }, create: { id: policyE2e.tagId, name: "科技创新", normalizedName: "科技创新" }, update: { name: "科技创新", status: "ACTIVE" } });
  await prisma.attachment.create({ data: { id: policyE2e.oldAttachmentId, originalFilename: "E2E旧政策.pdf", extension: "pdf", declaredMimeType: "application/pdf", detectedMimeType: "application/pdf", detectedFileType: "pdf", expectedSizeBytes: 10, actualSizeBytes: 10, sha256: "b".repeat(64), bucket: "test", region: "test", objectKey: "policy/e2e-old.pdf", uploadStatus: "UPLOADED", scanStatus: "PASSED", isTemporary: false, uploadedByPersonId: e2eUsers.admin.personId } });
  await prisma.policy.create({ data: { id: policyE2e.oldPolicyId, title: "E2E 旧政策", issuingDepartment: "宝应县测试部门", publicationDate: new Date("2025-01-01"), level: "县级", publicationStatus: "PUBLISHED", effectStatus: "CURRENT", createdByPersonId: e2eUsers.admin.personId, publishedAt: new Date("2025-01-02") } });
  await prisma.policyContentVersion.create({ data: { id: policyE2e.oldVersionId, policyId: policyE2e.oldPolicyId, versionNo: 1, snapshotJson: { title: "E2E 旧政策", interpretation: { targetAudience: "企业", supportContent: "旧支持", applicationConditions: "旧条件", keyClauses: ["旧条款"], evidence: [{ field: "支持内容", value: "旧支持", page: 1 }] } }, changedByPersonId: e2eUsers.admin.personId, coreFieldsConfirmedAt: new Date(), coreFieldsConfirmedById: e2eUsers.admin.personId } });
  await prisma.policy.update({ where: { id: policyE2e.oldPolicyId }, data: { currentVersionId: policyE2e.oldVersionId } });
  await prisma.policyTagRelation.create({ data: { policyId: policyE2e.oldPolicyId, tagId: policyE2e.tagId } });
  await prisma.attachmentLink.create({ data: { attachmentId: policyE2e.oldAttachmentId, entityType: "POLICY_CONTENT_VERSION", entityId: policyE2e.oldVersionId, relationType: "PRIMARY", createdByPersonId: e2eUsers.admin.personId } });
}
