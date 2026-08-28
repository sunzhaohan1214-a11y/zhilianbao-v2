import type {
  Prisma,
  Talent,
  TalentVersionChangeType,
} from "@/generated/prisma/client";
import { authorizeActor } from "@/modules/permissions/authorization";
import type { PermissionActor } from "@/modules/permissions/types";
import {
  writeTalentAudit,
  writeTalentTransition,
  type TalentMutationContext,
} from "./audit";
import {
  FakeTalentExtractionAdapter,
  parseTalentExtractionOutput,
  TalentAIOutputUnsafeError,
  type TalentExtractionAdapter,
  UnavailableTalentExtractionAdapter,
} from "./extraction";
import { isPrismaUniqueConflict, TalentError } from "./errors";
import {
  TalentRepository,
  type TalentTransaction,
} from "./repository/talent-repository";
import {
  createTalentChangeRequestSchema,
  resubmitTalentChangeRequestSchema,
  talentChangesSchema,
  talentCoreSchema,
  type TalentChanges,
  type TalentCoreInput,
} from "./schemas";

type ServiceInput = { actor: PermissionActor; context?: TalentMutationContext };
const normalize = (value: string | null | undefined) =>
  value === undefined
    ? undefined
    : value === null || value === ""
      ? null
      : value;
function snapshotTalent(
  talent: Pick<
    Talent,
    | "id"
    | "name"
    | "scopeType"
    | "organizationName"
    | "title"
    | "professionalDirection"
    | "workEducationExperience"
    | "representativeAchievements"
    | "originalRecommenderPersonId"
    | "currentContactPersonId"
    | "status"
    | "mergedIntoId"
    | "currentVersion"
  >,
): Prisma.InputJsonObject {
  return { ...talent };
}

export class TalentService {
  constructor(
    private readonly repository = new TalentRepository(),
    private readonly extraction: TalentExtractionAdapter = process.env
      .APP_ENV === "test"
      ? new FakeTalentExtractionAdapter()
      : new UnavailableTalentExtractionAdapter(),
  ) {}

  private async requireInternalPerson(tx: TalentTransaction, personId: string) {
    const person = await tx.person.findUnique({
      where: { id: personId },
      select: {
        id: true,
        name: true,
        personStatus: true,
        account: { select: { id: true, status: true, phone: true } },
      },
    });
    if (
      !person ||
      person.personStatus !== "ACTIVE" ||
      !person.account ||
      person.account.status === "DISABLED"
    )
      throw new TalentError(
        "TALENT_PERSON_INVALID",
        "推荐人、联系人或经办人必须是存在账号的在册内部人员",
      );
    return person;
  }

  private async attachRequestFiles(
    tx: TalentTransaction,
    requestId: string,
    ids: readonly string[],
    actorPersonId: string,
  ) {
    const unique = [...new Set(ids)].sort();
    if (unique.length !== ids.length)
      throw new TalentError("TALENT_ATTACHMENT_INVALID", "附件不能重复");
    for (const id of unique) {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          uploadedByPersonId: string;
          isTemporary: boolean | number;
          uploadStatus: string;
          scanStatus: string;
          linkId: string | null;
        }>
      >`
        SELECT a.id, a.uploaded_by_person_id AS uploadedByPersonId, a.is_temporary AS isTemporary,
          a.upload_status AS uploadStatus, a.scan_status AS scanStatus, l.id AS linkId
        FROM attachments a LEFT JOIN attachment_links l ON l.attachment_id = a.id
        WHERE a.id = ${id} FOR UPDATE`;
      const attachment = rows[0];
      if (
        !attachment ||
        rows.length !== 1 ||
        attachment.uploadedByPersonId !== actorPersonId ||
        !(attachment.isTemporary === true || attachment.isTemporary === 1) ||
        attachment.linkId !== null ||
        attachment.uploadStatus !== "UPLOADED" ||
        !["PENDING", "SCANNING", "PASSED"].includes(attachment.scanStatus)
      )
        throw new TalentError(
          "TALENT_ATTACHMENT_INVALID",
          "仅可提交本人本次上传且等待扫描或已通过扫描的临时附件",
        );
    }
    if (unique.length) {
      await tx.attachmentLink.createMany({
        data: unique.map((attachmentId) => ({
          attachmentId,
          entityType: "TALENT_CHANGE_REQUEST",
          entityId: requestId,
          relationType: "RESUME",
          createdByPersonId: actorPersonId,
        })),
      });
      await tx.attachment.updateMany({
        where: { id: { in: unique } },
        data: { isTemporary: false, permissionLevel: "SENSITIVE_PARENT" },
      });
    }
  }

  private async linkRequestFilesToVersion(
    tx: TalentTransaction,
    requestId: string,
    versionId: string,
    actorPersonId: string,
  ) {
    const links = await tx.attachmentLink.findMany({
      where: { entityType: "TALENT_CHANGE_REQUEST", entityId: requestId },
    });
    if (links.length)
      await tx.attachmentLink.createMany({
        data: links.map((link) => ({
          attachmentId: link.attachmentId,
          entityType: "TALENT_VERSION",
          entityId: versionId,
          relationType: link.relationType,
          createdByPersonId: actorPersonId,
        })),
        skipDuplicates: true,
      });
  }

  private async createFormalInTransaction(
    tx: TalentTransaction,
    core: TalentCoreInput,
    service: ServiceInput,
    changeType: "CREATE" | "CHANGE_REQUEST_APPROVED",
    reason?: string,
  ) {
    const recommenderId =
      core.originalRecommenderPersonId ?? service.actor.personId;
    await this.requireInternalPerson(tx, recommenderId);
    const talent = await tx.talent.create({
      data: {
        name: core.name,
        scopeType: core.scopeType,
        organizationName: core.organizationName,
        title: core.title,
        professionalDirection: core.professionalDirection,
        workEducationExperience: normalize(core.workEducationExperience),
        representativeAchievements: normalize(core.representativeAchievements),
        originalRecommenderPersonId: recommenderId,
        currentContactPersonId: recommenderId,
        createdByPersonId: service.actor.personId,
      },
    });
    const version = await tx.talentVersion.create({
      data: {
        talentId: talent.id,
        versionNo: 1,
        snapshotJson: snapshotTalent(talent),
        changeType,
        reason,
        changedByPersonId: service.actor.personId,
      },
    });
    await tx.talentContactPersonHistory.create({
      data: {
        talentId: talent.id,
        personId: recommenderId,
        effectiveAt: new Date(),
        changedByPersonId: service.actor.personId,
        changeReason: reason ?? "首次建档默认联系人",
      },
    });
    await writeTalentTransition(tx, {
      ...service,
      entityType: "TALENT",
      entityId: talent.id,
      toState: "ACTIVE",
      actionCode: "TALENT_CREATED",
      reason,
    });
    await writeTalentAudit(tx, {
      ...service,
      entityType: "TALENT",
      entityId: talent.id,
      actionCode: "TALENT_CREATED",
      after: snapshotTalent(talent),
      reason,
    });
    return { talent, version };
  }

  async createFormal(
    input: ServiceInput & {
      talent: unknown;
      attachmentIds?: readonly string[];
      reason?: string;
    },
  ) {
    await authorizeActor({
      actor: input.actor,
      action: "talent.edit_formal",
      resource: { resourceType: "talent", requiredScope: "GLOBAL_OPERATIONAL" },
    });
    const core = talentCoreSchema.parse(input.talent);
    return this.repository.transaction(async (tx) => {
      const request = await tx.talentChangeRequest.create({
        data: {
          requestType: "CREATE",
          status: "APPROVED",
          payloadSnapshot: { talent: core },
          submitterPersonId: input.actor.personId,
          reviewerPersonId: input.actor.personId,
          reviewReason: input.reason ?? "管理员直接建档",
          reviewedAt: new Date(),
        },
      });
      await this.attachRequestFiles(
        tx,
        request.id,
        input.attachmentIds ?? [],
        input.actor.personId,
      );
      const formal = await this.createFormalInTransaction(
        tx,
        core,
        input,
        "CREATE",
        input.reason ?? "管理员直接建档",
      );
      await this.linkRequestFilesToVersion(
        tx,
        request.id,
        formal.version.id,
        input.actor.personId,
      );
      await tx.talentChangeRequest.update({
        where: { id: request.id },
        data: { approvedTalentId: formal.talent.id },
      });
      await writeTalentTransition(tx, {
        ...input,
        entityType: "TALENT_CHANGE_REQUEST",
        entityId: request.id,
        toState: "APPROVED",
        actionCode: "TALENT_CHANGE_REQUEST_APPROVED",
        reason: input.reason ?? "管理员直接建档",
        metadata: { approvedTalentId: formal.talent.id, directAdminAction: true },
      });
      await writeTalentAudit(tx, {
        ...input,
        entityType: "TALENT_CHANGE_REQUEST",
        entityId: request.id,
        actionCode: "TALENT_CHANGE_REQUEST_APPROVED",
        after: { status: "APPROVED", approvedTalentId: formal.talent.id, directAdminAction: true },
        reason: input.reason ?? "管理员直接建档",
      });
      return formal.talent;
    });
  }

  async createFromImportInTransaction(
    tx: TalentTransaction,
    input: ServiceInput & { talent: unknown; reason: string },
  ) {
    await authorizeActor({ actor: input.actor, action: "talent.edit_formal", resource: {
      resourceType: "talent", requiredScope: "GLOBAL_OPERATIONAL",
    } });
    return this.createFormalInTransaction(tx, talentCoreSchema.parse(input.talent), input, "CREATE", input.reason);
  }

  async updateFromImportInTransaction(
    tx: TalentTransaction,
    input: ServiceInput & { talentId: string; changes: unknown; reason: string },
  ) {
    await authorizeActor({ actor: input.actor, action: "talent.edit_formal", resource: {
      resourceType: "talent", requiredScope: "GLOBAL_OPERATIONAL",
    } });
    return this.applyCorrection(tx, input.talentId, talentChangesSchema.parse(input.changes), input, input.reason, "FORMAL_CORRECTION");
  }

  async list(
    input: ServiceInput & {
      query: {
        scopeType?: "DOMESTIC" | "OVERSEAS";
        keyword?: string;
        direction?: string;
        organization?: string;
        title?: string;
        status?: "ACTIVE" | "DISABLED" | "MERGED";
        page: number;
        pageSize: number;
      };
    },
  ) {
    await authorizeActor({
      actor: input.actor,
      action: "talent.view",
      resource: { resourceType: "talent", requiredScope: "GLOBAL_PUBLISHED" },
    });
    if (input.query.status && !input.actor.hasGlobalOperational)
      throw new TalentError(
        "TALENT_FORBIDDEN",
        "只有管理端可以查看停用或合并人才",
      );
    return this.repository.list({
      ...input.query,
      status: input.query.status ?? "ACTIVE",
    });
  }
  async stats(input: ServiceInput) {
    await authorizeActor({
      actor: input.actor,
      action: "talent.view",
      resource: { resourceType: "talent", requiredScope: "GLOBAL_PUBLISHED" },
    });
    return this.repository.stats();
  }
  async governanceOptions(input: ServiceInput) {
    await authorizeActor({ actor: input.actor, action: "talent.edit_formal", resource: { resourceType: "talent", requiredScope: "GLOBAL_OPERATIONAL" } });
    return { people: await this.repository.listInternalPeople() };
  }
  async recommendationOptions(input: ServiceInput) {
    await authorizeActor({ actor: input.actor, action: "talent.submit" });
    return { people: await this.repository.listInternalPeople() };
  }
  async roundOptions(input: ServiceInput) {
    await authorizeActor({ actor: input.actor, action: "talent.contact.start" });
    return { areas: await this.repository.listActiveAreas(input.actor.townshipAreaIds) };
  }
  async detail(input: ServiceInput & { talentId: string }) {
    await authorizeActor({
      actor: input.actor,
      action: "talent.view",
      resource: { resourceType: "talent", requiredScope: "GLOBAL_PUBLISHED" },
    });
    return this.repository.transaction(async (tx) => {
      const talent = await this.repository.findTalent(tx, input.talentId, input.actor.hasGlobalOperational);
      if (
        !talent ||
        (talent.status !== "ACTIVE" && !input.actor.hasGlobalOperational)
      )
        throw new TalentError("TALENT_NOT_FOUND", "人才不存在");
      const versionIds = talent.versions.map((version) => version.id);
      const links = await tx.attachmentLink.findMany({
        where: { entityType: "TALENT_VERSION", entityId: { in: versionIds } },
        include: {
          attachment: {
            select: { id: true, originalFilename: true, scanStatus: true },
          },
        },
        orderBy: { createdAt: "asc" },
      });
      return {
        ...talent,
        versions: talent.versions.map((version) => ({
          ...version,
          attachments: links
            .filter((link) => link.entityId === version.id)
            .map((link) => ({
              ...link.attachment,
              relationType: link.relationType,
            })),
        })),
        townshipRounds: talent.townshipRounds.map((round) => ({
          ...round,
          durationDays: Math.max(
            1,
            Math.ceil(
              ((
                round.completedAt ??
                round.withdrawnAt ??
                new Date()
              ).getTime() -
                round.startedAt.getTime()) /
                86_400_000,
            ),
          ),
        })),
      };
    });
  }

  async createChangeRequest(input: ServiceInput & { request: unknown }) {
    await authorizeActor({ actor: input.actor, action: "talent.submit" });
    const request = createTalentChangeRequestSchema.parse(input.request);
    if (request.requestType === "CORRECTION")
      await authorizeActor({
        actor: input.actor,
        action: "talent.correct_request",
      });
    return this.repository.transaction(async (tx) => {
      if (request.requestType === "CORRECTION") {
        const target = await tx.talent.findUnique({
          where: { id: request.targetTalentId },
        });
        if (!target)
          throw new TalentError("TALENT_NOT_FOUND", "目标人才不存在");
        if (target.status !== "ACTIVE")
          throw new TalentError(
            "TALENT_STATE_CONFLICT",
            "只有有效人才可以提交纠错",
          );
        if (target.currentVersion !== request.baseTalentVersion)
          throw new TalentError(
            "TALENT_VERSION_CONFLICT",
            "人才版本已变化，请刷新后重新提交",
          );
        if (
          request.payload.changes.originalRecommenderPersonId &&
          !request.payload.originalRecommenderChangeReason
        )
          throw new TalentError(
            "TALENT_STATE_CONFLICT",
            "纠正原始推荐人必须填写专项原因",
          );
      }
      const created = await tx.talentChangeRequest.create({
        data:
          request.requestType === "CREATE"
            ? {
                requestType: "CREATE",
                payloadSnapshot: request.payload,
                submitterPersonId: input.actor.personId,
              }
            : {
                requestType: "CORRECTION",
                targetTalentId: request.targetTalentId,
                baseTalentVersion: request.baseTalentVersion,
                payloadSnapshot: request.payload,
                submitterPersonId: input.actor.personId,
              },
      });
      await this.attachRequestFiles(
        tx,
        created.id,
        request.attachmentIds,
        input.actor.personId,
      );
      await writeTalentTransition(tx, {
        ...input,
        entityType: "TALENT_CHANGE_REQUEST",
        entityId: created.id,
        toState: "PENDING_REVIEW",
        actionCode: "TALENT_CHANGE_REQUEST_CREATED",
      });
      await writeTalentAudit(tx, {
        ...input,
        entityType: "TALENT_CHANGE_REQUEST",
        entityId: created.id,
        actionCode: "TALENT_CHANGE_REQUEST_CREATED",
        after: {
          requestType: created.requestType,
          status: created.status,
          targetTalentId: created.targetTalentId,
        },
      });
      return created;
    });
  }

  async listChangeRequests(
    input: ServiceInput & {
      query: {
        status?: "PENDING_REVIEW" | "APPROVED" | "RETURNED" | "CLOSED";
        requestType?: "CREATE" | "CORRECTION";
        page: number;
        pageSize: number;
      };
    },
  ) {
    const canReview =
      input.actor.capabilities.has("talent.review") &&
      input.actor.hasGlobalOperational;
    if (!canReview)
      await authorizeActor({ actor: input.actor, action: "talent.submit" });
    return this.repository.listRequests({
      ...input.query,
      submitterPersonId: canReview ? undefined : input.actor.personId,
    });
  }
  async getChangeRequest(input: ServiceInput & { requestId: string }) {
    return this.repository.transaction(async (tx) => {
      const request = await this.repository.findRequest(tx, input.requestId);
      if (!request)
        throw new TalentError("TALENT_REQUEST_NOT_FOUND", "人才申请不存在");
      const canReview =
        input.actor.capabilities.has("talent.review") &&
        input.actor.hasGlobalOperational;
      if (!canReview) {
        await authorizeActor({ actor: input.actor, action: "talent.submit" });
        if (request.submitterPersonId !== input.actor.personId)
          throw new TalentError("TALENT_FORBIDDEN", "只能查看本人提交的人才申请");
      }
      let duplicateCandidates: Awaited<ReturnType<TalentRepository["duplicateCandidates"]>> = [];
      if (canReview && request.requestType === "CREATE") {
        const payload = createTalentChangeRequestSchema.options[0].shape.payload.parse(request.payloadSnapshot);
        duplicateCandidates = await this.repository.duplicateCandidates(tx, payload.talent.name, payload.talent.organizationName);
      }
      return { ...request, duplicateCandidates };
    });
  }

  async resubmitChangeRequest(
    input: ServiceInput & { requestId: string; body: unknown },
  ) {
    await authorizeActor({ actor: input.actor, action: "talent.submit" });
    const body = resubmitTalentChangeRequestSchema.parse(input.body);
    return this.repository.transaction(async (tx) => {
      await this.repository.lockRequest(tx, input.requestId).catch(() => {
        throw new TalentError("TALENT_REQUEST_NOT_FOUND", "人才申请不存在");
      });
      const request = await tx.talentChangeRequest.findUnique({
        where: { id: input.requestId },
      });
      if (!request)
        throw new TalentError("TALENT_REQUEST_NOT_FOUND", "人才申请不存在");
      if (request.requestType === "CORRECTION")
        await authorizeActor({
          actor: input.actor,
          action: "talent.correct_request",
        });
      if (
        request.status !== "RETURNED" ||
        request.submitterPersonId !== input.actor.personId
      )
        throw new TalentError(
          "TALENT_REQUEST_STATE_CONFLICT",
          "只有原提交人可以重新提交已退回申请",
        );
      let payload: Prisma.InputJsonValue;
      let baseVersion = request.baseTalentVersion;
      if (request.requestType === "CREATE")
        payload =
          createTalentChangeRequestSchema.options[0].shape.payload.parse(
            body.payload,
          );
      else {
        const parsed =
          createTalentChangeRequestSchema.options[1].shape.payload.parse(
            body.payload,
          );
        const target = await tx.talent.findUnique({
          where: { id: request.targetTalentId! },
        });
        if (!target || target.status !== "ACTIVE")
          throw new TalentError(
            "TALENT_STATE_CONFLICT",
            "目标人才当前不可纠错",
          );
        baseVersion = body.baseTalentVersion ?? target.currentVersion;
        if (baseVersion !== target.currentVersion)
          throw new TalentError(
            "TALENT_VERSION_CONFLICT",
            "人才版本已变化，请刷新后重新提交",
          );
        payload = parsed;
      }
      const updated = await tx.talentChangeRequest.update({
        where: { id: request.id },
        data: {
          payloadSnapshot: payload,
          baseTalentVersion: baseVersion,
          status: "PENDING_REVIEW",
          reviewerPersonId: null,
          reviewReason: null,
          reviewedAt: null,
          submittedAt: new Date(),
        },
      });
      await writeTalentTransition(tx, {
        ...input,
        entityType: "TALENT_CHANGE_REQUEST",
        entityId: request.id,
        fromState: "RETURNED",
        toState: "PENDING_REVIEW",
        actionCode: "TALENT_CHANGE_REQUEST_RESUBMITTED",
      });
      return updated;
    });
  }

  private async applyCorrection(
    tx: TalentTransaction,
    talentId: string,
    changes: TalentChanges,
    service: ServiceInput,
    reason: string,
    changeType: TalentVersionChangeType,
    baseVersion?: number,
  ) {
    await this.repository.lockTalent(tx, talentId);
    const current = await tx.talent.findUnique({ where: { id: talentId } });
    if (!current) throw new TalentError("TALENT_NOT_FOUND", "人才不存在");
    if (current.status !== "ACTIVE")
      throw new TalentError("TALENT_STATE_CONFLICT", "当前人才不可修改");
    if (baseVersion !== undefined && current.currentVersion !== baseVersion)
      throw new TalentError(
        "TALENT_VERSION_CONFLICT",
        "人才版本已变化，请重新查看",
        {
          expectedVersion: baseVersion,
          currentVersion: current.currentVersion,
        },
      );
    if (changes.originalRecommenderPersonId)
      await this.requireInternalPerson(tx, changes.originalRecommenderPersonId);
    const before = snapshotTalent(current);
    const updated = await tx.talent.update({
      where: { id: talentId },
      data: {
        ...changes,
        workEducationExperience: normalize(changes.workEducationExperience),
        representativeAchievements: normalize(
          changes.representativeAchievements,
        ),
        currentVersion: { increment: 1 },
      },
    });
    const version = await tx.talentVersion.create({
      data: {
        talentId,
        versionNo: updated.currentVersion,
        snapshotJson: snapshotTalent(updated),
        changeType,
        reason,
        changedByPersonId: service.actor.personId,
      },
    });
    await writeTalentAudit(tx, {
      ...service,
      entityType: "TALENT",
      entityId: talentId,
      actionCode: "TALENT_CORRECTED",
      before,
      after: snapshotTalent(updated),
      reason,
    });
    return { talent: updated, version };
  }
  async formalCorrection(
    input: ServiceInput & {
      talentId: string;
      changes: unknown;
      reason: string;
      baseVersion?: number;
    },
  ) {
    await authorizeActor({
      actor: input.actor,
      action: "talent.edit_formal",
      resource: { resourceType: "talent", requiredScope: "GLOBAL_OPERATIONAL" },
    });
    const changes = talentChangesSchema.parse(input.changes);
    return this.repository.transaction(async (tx) => {
      await this.repository.lockTalent(tx, input.talentId).catch(() => {
        throw new TalentError("TALENT_NOT_FOUND", "人才不存在");
      });
      const current = await tx.talent.findUnique({ where: { id: input.talentId } });
      if (!current) throw new TalentError("TALENT_NOT_FOUND", "人才不存在");
      const baseTalentVersion = input.baseVersion ?? current.currentVersion;
      const request = await tx.talentChangeRequest.create({ data: {
        requestType: "CORRECTION", status: "APPROVED", targetTalentId: current.id,
        approvedTalentId: current.id, baseTalentVersion, payloadSnapshot: { changes },
        submitterPersonId: input.actor.personId, reviewerPersonId: input.actor.personId,
        reviewReason: input.reason.trim(), reviewedAt: new Date(),
      } });
      const corrected = await this.applyCorrection(tx, current.id, changes, input, input.reason.trim(), "FORMAL_CORRECTION", baseTalentVersion);
      await writeTalentTransition(tx, { ...input, entityType: "TALENT_CHANGE_REQUEST", entityId: request.id,
        toState: "APPROVED", actionCode: "TALENT_CHANGE_REQUEST_APPROVED", reason: input.reason.trim(),
        metadata: { approvedTalentId: current.id, directAdminAction: true } });
      await writeTalentAudit(tx, { ...input, entityType: "TALENT_CHANGE_REQUEST", entityId: request.id,
        actionCode: "TALENT_CHANGE_REQUEST_APPROVED", after: { status: "APPROVED", approvedTalentId: current.id, directAdminAction: true }, reason: input.reason.trim() });
      return corrected.talent;
    });
  }

  async reviewChangeRequest(
    input: ServiceInput & {
      requestId: string;
      decision: "APPROVE" | "RETURN" | "CLOSE";
      reason?: string;
    },
  ) {
    await authorizeActor({
      actor: input.actor,
      action: "talent.review",
      resource: {
        resourceType: "talent_change_request",
        requiredScope: "GLOBAL_OPERATIONAL",
      },
    });
    return this.repository.transaction(async (tx) => {
      await this.repository.lockRequest(tx, input.requestId).catch(() => {
        throw new TalentError("TALENT_REQUEST_NOT_FOUND", "人才申请不存在");
      });
      const request = await tx.talentChangeRequest.findUnique({
        where: { id: input.requestId },
      });
      if (!request || request.status !== "PENDING_REVIEW")
        throw new TalentError(
          "TALENT_REQUEST_STATE_CONFLICT",
          "人才申请已被处理",
        );
      if (input.decision !== "APPROVE") {
        const status = input.decision === "RETURN" ? "RETURNED" : "CLOSED";
        const updated = await tx.talentChangeRequest.update({
          where: { id: request.id },
          data: {
            status,
            reviewerPersonId: input.actor.personId,
            reviewReason: input.reason!,
            reviewedAt: new Date(),
          },
        });
        await writeTalentTransition(tx, {
          ...input,
          entityType: "TALENT_CHANGE_REQUEST",
          entityId: request.id,
          fromState: "PENDING_REVIEW",
          toState: status,
          actionCode: `TALENT_CHANGE_REQUEST_${status}`,
          reason: input.reason,
        });
        return { request: updated, duplicateCandidates: [] };
      }
      let approvedTalentId: string;
      let versionId: string;
      let duplicates: unknown[] = [];
      if (request.requestType === "CREATE") {
        const payload =
          createTalentChangeRequestSchema.options[0].shape.payload.parse(
            request.payloadSnapshot,
          );
        duplicates = await this.repository.duplicateCandidates(
          tx,
          payload.talent.name,
          payload.talent.organizationName,
        );
        const formal = await this.createFormalInTransaction(
          tx,
          payload.talent,
          input,
          "CHANGE_REQUEST_APPROVED",
          input.reason,
        );
        approvedTalentId = formal.talent.id;
        versionId = formal.version.id;
      } else {
        const payload =
          createTalentChangeRequestSchema.options[1].shape.payload.parse(
            request.payloadSnapshot,
          );
        if (!request.targetTalentId || request.baseTalentVersion === null)
          throw new TalentError(
            "TALENT_REQUEST_STATE_CONFLICT",
            "纠错申请数据不完整",
          );
        if (
          payload.changes.originalRecommenderPersonId &&
          !payload.originalRecommenderChangeReason
        )
          throw new TalentError(
            "TALENT_STATE_CONFLICT",
            "纠正原始推荐人必须填写专项原因",
          );
        const corrected = await this.applyCorrection(
          tx,
          request.targetTalentId,
          payload.changes,
          input,
          input.reason ??
            payload.originalRecommenderChangeReason ??
            "人才纠错审核通过",
          "CHANGE_REQUEST_APPROVED",
          request.baseTalentVersion,
        );
        approvedTalentId = corrected.talent.id;
        versionId = corrected.version.id;
      }
      await this.linkRequestFilesToVersion(
        tx,
        request.id,
        versionId,
        input.actor.personId,
      );
      const updated = await tx.talentChangeRequest.update({
        where: { id: request.id },
        data: {
          status: "APPROVED",
          reviewerPersonId: input.actor.personId,
          reviewReason: input.reason,
          reviewedAt: new Date(),
          approvedTalentId,
        },
      });
      await writeTalentTransition(tx, {
        ...input,
        entityType: "TALENT_CHANGE_REQUEST",
        entityId: request.id,
        fromState: "PENDING_REVIEW",
        toState: "APPROVED",
        actionCode: "TALENT_CHANGE_REQUEST_APPROVED",
        reason: input.reason,
        metadata: { approvedTalentId },
      });
      return { request: updated, duplicateCandidates: duplicates };
    });
  }

  async changeCurrentContact(
    input: ServiceInput & {
      talentId: string;
      personId: string;
      reason: string;
    },
  ) {
    await authorizeActor({
      actor: input.actor,
      action: "talent.contact_person.change",
      resource: { resourceType: "talent", requiredScope: "GLOBAL_OPERATIONAL" },
    });
    return this.repository.transaction(async (tx) => {
      await this.repository.lockTalent(tx, input.talentId);
      const current = await tx.talent.findUnique({
        where: { id: input.talentId },
      });
      if (!current) throw new TalentError("TALENT_NOT_FOUND", "人才不存在");
      if (current.status !== "ACTIVE")
        throw new TalentError(
          "TALENT_STATE_CONFLICT",
          "只有有效人才可变更当前联系人",
        );
      await this.requireInternalPerson(tx, input.personId);
      if (current.currentContactPersonId === input.personId)
        throw new TalentError(
          "TALENT_STATE_CONFLICT",
          "新联系人不能与当前联系人相同",
        );
      const histories = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM talent_contact_person_history WHERE talent_id = ${input.talentId} AND active_key = 1 FOR UPDATE`;
      if (histories.length !== 1)
        throw new TalentError(
          "TALENT_STATE_CONFLICT",
          "当前联系人历史记录异常，已拒绝变更",
        );
      const now = new Date();
      await tx.talentContactPersonHistory.update({
        where: { id: histories[0].id },
        data: { expiredAt: now, activeKey: null },
      });
      await tx.talentContactPersonHistory.create({
        data: {
          talentId: current.id,
          personId: input.personId,
          effectiveAt: now,
          changeReason: input.reason.trim(),
          changedByPersonId: input.actor.personId,
        },
      });
      const updated = await tx.talent.update({
        where: { id: current.id },
        data: {
          currentContactPersonId: input.personId,
          currentVersion: { increment: 1 },
        },
      });
      await tx.talentVersion.create({
        data: {
          talentId: current.id,
          versionNo: updated.currentVersion,
          snapshotJson: snapshotTalent(updated),
          changeType: "CONTACT_PERSON_CHANGED",
          reason: input.reason.trim(),
          changedByPersonId: input.actor.personId,
        },
      });
      await writeTalentAudit(tx, {
        ...input,
        entityType: "TALENT",
        entityId: current.id,
        actionCode: "TALENT_CONTACT_PERSON_CHANGED",
        before: { currentContactPersonId: current.currentContactPersonId },
        after: { currentContactPersonId: input.personId },
        reason: input.reason.trim(),
      });
      return updated;
    });
  }

  private async requireRoundHandler(
    tx: TalentTransaction,
    personId: string,
    areaId: string,
  ) {
    await this.requireInternalPerson(tx, personId);
    const now = new Date();
    const valid = await tx.person.findFirst({
      where: {
        id: personId,
        appointments: {
          some: {
            effectiveAt: { lte: now },
            OR: [{ expiredAt: null }, { expiredAt: { gt: now } }],
            organization: {
              type: "TOWNSHIP_ORG",
              status: "ACTIVE",
              areaMappings: {
                some: {
                  areaId,
                  effectiveAt: { lte: now },
                  OR: [{ expiredAt: null }, { expiredAt: { gt: now } }],
                },
              },
            },
          },
        },
        roleAssignments: {
          some: {
            roleCode: "TOWNSHIP_STAFF",
            effectiveAt: { lte: now },
            OR: [{ expiredAt: null }, { expiredAt: { gt: now } }],
          },
        },
      },
      select: { id: true },
    });
    if (!valid)
      throw new TalentError(
        "TALENT_PERSON_INVALID",
        "所选经办人必须是该镇区当前在岗工作人员",
      );
  }
  async startRound(
    input: ServiceInput & {
      talentId: string;
      areaId: string;
      handlerPersonId?: string;
    },
  ) {
    await authorizeActor({
      actor: input.actor,
      action: "talent.contact.start",
      resource: {
        resourceType: "talent_round",
        requiredScope: "TOWNSHIP",
        areaId: input.areaId,
      },
    });
    try {
      return await this.repository.transaction(async (tx) => {
        await this.repository.lockTalent(tx, input.talentId);
        const talent = await tx.talent.findUnique({
          where: { id: input.talentId },
        });
        if (!talent) throw new TalentError("TALENT_NOT_FOUND", "人才不存在");
        if (talent.status !== "ACTIVE")
          throw new TalentError(
            "TALENT_STATE_CONFLICT",
            "只有有效人才可以发起对接",
          );
        const area = await tx.administrativeArea.findFirst({
          where: {
            id: input.areaId,
            status: "ACTIVE",
            type: {
              in: ["TOWNSHIP", "PARK", "HIGH_TECH_ZONE", "DEVELOPMENT_ZONE"],
            },
          },
        });
        if (!area)
          throw new TalentError("TALENT_AREA_INVALID", "镇区不存在或已停用");
        const handlerPersonId = input.handlerPersonId ?? input.actor.personId;
        await this.requireRoundHandler(tx, handlerPersonId, input.areaId);
        const latest = await tx.talentTownshipRound.aggregate({
          where: { talentId: input.talentId, areaId: input.areaId },
          _max: { roundNo: true },
        });
        const round = await tx.talentTownshipRound.create({
          data: {
            talentId: input.talentId,
            areaId: input.areaId,
            roundNo: (latest._max.roundNo ?? 0) + 1,
            startedByPersonId: input.actor.personId,
            currentHandlerPersonId: handlerPersonId,
          },
        });
        await writeTalentTransition(tx, {
          ...input,
          entityType: "TALENT_TOWNSHIP_ROUND",
          entityId: round.id,
          toState: "IN_PROGRESS",
          actionCode: "TALENT_ROUND_STARTED",
        });
        await writeTalentAudit(tx, {
          ...input,
          entityType: "TALENT_TOWNSHIP_ROUND",
          entityId: round.id,
          actionCode: "TALENT_ROUND_STARTED",
          after: {
            talentId: round.talentId,
            areaId: round.areaId,
            roundNo: round.roundNo,
            handlerPersonId,
          },
        });
        return round;
      });
    } catch (error) {
      if (isPrismaUniqueConflict(error))
        throw new TalentError(
          "TALENT_ROUND_CONFLICT",
          "该镇区已有进行中的对接轮次",
        );
      throw error;
    }
  }
  private async roundForMutation(tx: TalentTransaction, id: string) {
    await this.repository.lockRound(tx, id).catch(() => {
      throw new TalentError("TALENT_ROUND_NOT_FOUND", "对接轮次不存在");
    });
    const round = await tx.talentTownshipRound.findUnique({
      where: { id },
      include: { talent: true },
    });
    if (!round)
      throw new TalentError("TALENT_ROUND_NOT_FOUND", "对接轮次不存在");
    if (round.voidedAt || round.status !== "IN_PROGRESS")
      throw new TalentError(
        "TALENT_ROUND_CONFLICT",
        "对接轮次已终止，不能继续操作",
      );
    return round;
  }
  private async authorizeProgress(
    actor: PermissionActor,
    round: { areaId: string; talent: { currentContactPersonId: string } },
  ) {
    const isContact = round.talent.currentContactPersonId === actor.personId;
    await authorizeActor({
      actor,
      action: "talent.contact.update",
      resource: {
        resourceType: "talent_round",
        requiredScope: isContact ? "GLOBAL_PUBLISHED" : "TOWNSHIP",
        areaId: round.areaId,
      },
      relationPolicy: isContact || actor.townshipAreaIds.includes(round.areaId),
    });
  }
  async addProgress(
    input: ServiceInput & {
      roundId: string;
      content: string;
      nextStep?: string;
    },
  ) {
    return this.repository.transaction(async (tx) => {
      const round = await this.roundForMutation(tx, input.roundId);
      await this.authorizeProgress(input.actor, round);
      const progress = await tx.talentTownshipProgress.create({
        data: {
          roundId: round.id,
          content: input.content.trim(),
          nextStep: normalize(input.nextStep),
          createdByPersonId: input.actor.personId,
        },
      });
      await writeTalentAudit(tx, {
        ...input,
        entityType: "TALENT_TOWNSHIP_PROGRESS",
        entityId: progress.id,
        actionCode: "TALENT_ROUND_PROGRESS_ADDED",
        after: {
          roundId: round.id,
          content: progress.content,
          nextStep: progress.nextStep,
        },
      });
      return progress;
    });
  }
  async completeRound(
    input: ServiceInput & { roundId: string; resultSummary?: string },
  ) {
    return this.repository.transaction(async (tx) => {
      const round = await this.roundForMutation(tx, input.roundId);
      const isContact =
        round.talent.currentContactPersonId === input.actor.personId;
      await authorizeActor({
        actor: input.actor,
        action: "talent.contact.complete",
        resource: {
          resourceType: "talent_round",
          requiredScope: isContact ? "GLOBAL_PUBLISHED" : "TOWNSHIP",
          areaId: round.areaId,
        },
        relationPolicy:
          isContact || input.actor.townshipAreaIds.includes(round.areaId),
      });
      const updated = await tx.talentTownshipRound.update({
        where: { id: round.id },
        data: {
          status: "COMPLETED",
          activeKey: null,
          completedAt: new Date(),
          resultSummary: normalize(input.resultSummary),
        },
      });
      await writeTalentTransition(tx, {
        ...input,
        entityType: "TALENT_TOWNSHIP_ROUND",
        entityId: round.id,
        fromState: "IN_PROGRESS",
        toState: "COMPLETED",
        actionCode: "TALENT_ROUND_COMPLETED",
      });
      return updated;
    });
  }
  async withdrawRound(
    input: ServiceInput & { roundId: string; reason: string },
  ) {
    return this.repository.transaction(async (tx) => {
      const round = await this.roundForMutation(tx, input.roundId);
      await authorizeActor({
        actor: input.actor,
        action: "talent.contact.withdraw",
        resource: {
          resourceType: "talent_round",
          requiredScope: "TOWNSHIP",
          areaId: round.areaId,
        },
      });
      const updated = await tx.talentTownshipRound.update({
        where: { id: round.id },
        data: {
          status: "WITHDRAWN",
          activeKey: null,
          withdrawnAt: new Date(),
          withdrawReason: input.reason.trim(),
        },
      });
      await writeTalentTransition(tx, {
        ...input,
        entityType: "TALENT_TOWNSHIP_ROUND",
        entityId: round.id,
        fromState: "IN_PROGRESS",
        toState: "WITHDRAWN",
        actionCode: "TALENT_ROUND_WITHDRAWN",
        reason: input.reason.trim(),
      });
      return updated;
    });
  }
  async voidRound(input: ServiceInput & { roundId: string; reason: string }) {
    await authorizeActor({
      actor: input.actor,
      action: "talent.round.void",
      resource: {
        resourceType: "talent_round",
        requiredScope: "GLOBAL_OPERATIONAL",
      },
    });
    return this.repository.transaction(async (tx) => {
      await this.repository.lockRound(tx, input.roundId).catch(() => {
        throw new TalentError("TALENT_ROUND_NOT_FOUND", "对接轮次不存在");
      });
      const round = await tx.talentTownshipRound.findUnique({
        where: { id: input.roundId },
      });
      if (!round)
        throw new TalentError("TALENT_ROUND_NOT_FOUND", "对接轮次不存在");
      if (round.voidedAt)
        throw new TalentError("TALENT_ROUND_CONFLICT", "对接轮次已作废");
      const updated = await tx.talentTownshipRound.update({
        where: { id: round.id },
        data: {
          voidedAt: new Date(),
          voidedByPersonId: input.actor.personId,
          voidReason: input.reason.trim(),
          activeKey: null,
        },
      });
      await writeTalentAudit(tx, {
        ...input,
        entityType: "TALENT_TOWNSHIP_ROUND",
        entityId: round.id,
        actionCode: "TALENT_ROUND_VOIDED",
        before: { status: round.status, voidedAt: null },
        after: {
          status: round.status,
          voidedAt: updated.voidedAt?.toISOString(),
        },
        reason: input.reason.trim(),
      });
      return updated;
    });
  }

  private async statusVersion(
    tx: TalentTransaction,
    current: Talent,
    service: ServiceInput,
    status: "DISABLED" | "MERGED",
    changeType: "DISABLE" | "MERGE",
    reason: string,
    mergedIntoId?: string,
  ) {
    const updated = await tx.talent.update({
      where: { id: current.id },
      data: { status, mergedIntoId, currentVersion: { increment: 1 } },
    });
    await tx.talentVersion.create({
      data: {
        talentId: current.id,
        versionNo: updated.currentVersion,
        snapshotJson: snapshotTalent(updated),
        changeType,
        reason,
        changedByPersonId: service.actor.personId,
      },
    });
    await writeTalentTransition(tx, {
      ...service,
      entityType: "TALENT",
      entityId: current.id,
      fromState: current.status,
      toState: status,
      actionCode: `TALENT_${status}`,
      reason,
    });
    await writeTalentAudit(tx, {
      ...service,
      entityType: "TALENT",
      entityId: current.id,
      actionCode: `TALENT_${status}`,
      before: snapshotTalent(current),
      after: snapshotTalent(updated),
      reason,
    });
    return updated;
  }
  async disable(input: ServiceInput & { talentId: string; reason: string }) {
    await authorizeActor({
      actor: input.actor,
      action: "talent.disable",
      resource: { resourceType: "talent", requiredScope: "GLOBAL_OPERATIONAL" },
    });
    return this.repository.transaction(async (tx) => {
      await this.repository.lockTalent(tx, input.talentId);
      const current = await tx.talent.findUnique({
        where: { id: input.talentId },
      });
      if (!current) throw new TalentError("TALENT_NOT_FOUND", "人才不存在");
      if (current.status !== "ACTIVE")
        throw new TalentError("TALENT_STATE_CONFLICT", "只有有效人才可以停用");
      if (
        await tx.talentTownshipRound.count({
          where: {
            talentId: current.id,
            status: "IN_PROGRESS",
            voidedAt: null,
          },
        })
      )
        throw new TalentError(
          "TALENT_STATE_CONFLICT",
          "存在进行中对接轮次，不能停用",
        );
      return this.statusVersion(
        tx,
        current,
        input,
        "DISABLED",
        "DISABLE",
        input.reason.trim(),
      );
    });
  }
  async merge(
    input: ServiceInput & {
      talentId: string;
      targetTalentId: string;
      reason: string;
    },
  ) {
    await authorizeActor({
      actor: input.actor,
      action: "talent.merge",
      resource: { resourceType: "talent", requiredScope: "GLOBAL_OPERATIONAL" },
    });
    if (input.talentId === input.targetTalentId)
      throw new TalentError("TALENT_STATE_CONFLICT", "人才不能合并到自身");
    return this.repository.transaction(async (tx) => {
      await this.repository.lockTalents(tx, [
        input.talentId,
        input.targetTalentId,
      ]);
      const [source, target] = await Promise.all([
        tx.talent.findUnique({ where: { id: input.talentId } }),
        tx.talent.findUnique({ where: { id: input.targetTalentId } }),
      ]);
      if (!source || !target)
        throw new TalentError("TALENT_NOT_FOUND", "源人才或目标人才不存在");
      if (source.status !== "ACTIVE" || target.status !== "ACTIVE")
        throw new TalentError(
          "TALENT_STATE_CONFLICT",
          "源人才与目标人才都必须有效",
        );
      if (
        await tx.talentTownshipRound.count({
          where: { talentId: source.id, status: "IN_PROGRESS", voidedAt: null },
        })
      )
        throw new TalentError(
          "TALENT_STATE_CONFLICT",
          "源人才存在进行中对接轮次，不能合并",
        );
      let cursor: string | null = target.mergedIntoId;
      const visited = new Set([source.id]);
      while (cursor) {
        if (visited.has(cursor))
          throw new TalentError("TALENT_STATE_CONFLICT", "合并会形成循环");
        visited.add(cursor);
        const next: { mergedIntoId: string | null } | null =
          await tx.talent.findUnique({
            where: { id: cursor },
            select: { mergedIntoId: true },
          });
        cursor = next?.mergedIntoId ?? null;
      }
      return this.statusVersion(
        tx,
        source,
        input,
        "MERGED",
        "MERGE",
        input.reason.trim(),
        target.id,
      );
    });
  }

  async extractAI(
    input: ServiceInput & { requestId: string; attachmentId: string },
  ) {
    await authorizeActor({ actor: input.actor, action: "talent.submit" });
    const pending = await this.repository.transaction(async (tx) => {
      await this.repository.lockRequest(tx, input.requestId).catch(() => {
        throw new TalentError("TALENT_REQUEST_NOT_FOUND", "人才申请不存在");
      });
      const request = await tx.talentChangeRequest.findUnique({
        where: { id: input.requestId },
      });
      if (!request)
        throw new TalentError("TALENT_REQUEST_NOT_FOUND", "人才申请不存在");
      if (request.requestType === "CORRECTION")
        await authorizeActor({
          actor: input.actor,
          action: "talent.correct_request",
        });
      if (request.submitterPersonId !== input.actor.personId)
        throw new TalentError("TALENT_FORBIDDEN", "仅申请提交人可发起简历提取");
      if (
        request.status !== "PENDING_REVIEW" &&
        request.status !== "RETURNED"
      )
        throw new TalentError(
          "TALENT_REQUEST_STATE_CONFLICT",
          "当前申请状态不允许发起简历提取",
        );
      const link = await tx.attachmentLink.findFirst({
        where: {
          attachmentId: input.attachmentId,
          entityType: "TALENT_CHANGE_REQUEST",
          entityId: request.id,
        },
        include: { attachment: true },
      });
      if (
        !link ||
        link.attachment.uploadStatus !== "UPLOADED" ||
        link.attachment.scanStatus !== "PASSED"
      )
        throw new TalentError(
          "TALENT_ATTACHMENT_INVALID",
          "证据附件必须属于当前申请且已通过安全扫描",
        );
      const extraction = await tx.talentAIExtraction.create({
        data: {
          requestId: request.id,
          attachmentId: input.attachmentId,
          provider: this.extraction.provider,
          model: this.extraction.model,
          promptVersion: this.extraction.promptVersion,
          requestedByPersonId: input.actor.personId,
        },
      });
      await writeTalentAudit(tx, {
        ...input,
        actionCode: "TALENT_AI_EXTRACTION_REQUESTED",
        entityType: "TALENT_AI_EXTRACTION",
        entityId: extraction.id,
        after: {
          requestId: request.id,
          attachmentId: input.attachmentId,
          provider: this.extraction.provider,
          model: this.extraction.model,
          promptVersion: this.extraction.promptVersion,
        },
      });
      return extraction;
    });
    try {
      const raw = await this.extraction.extract({
        attachmentId: input.attachmentId,
      });
      const result = parseTalentExtractionOutput(raw, input.attachmentId);
      return this.repository.transaction((tx) =>
        tx.talentAIExtraction.update({
          where: { id: pending.id },
          data: {
            status: "COMPLETED",
            candidateJson: result.candidate as Prisma.InputJsonObject,
            evidenceJson: result.evidence as Prisma.InputJsonObject,
          },
        }),
      );
    } catch (error) {
      const unsafe = error instanceof TalentAIOutputUnsafeError;
      const failed = await this.repository.transaction((tx) =>
        tx.talentAIExtraction.update({
          where: { id: pending.id },
          data: {
            status: "FAILED",
            failureCode: unsafe
              ? "TALENT_AI_OUTPUT_UNSAFE"
              : "TALENT_AI_EXTRACTION_UNAVAILABLE",
          },
        }),
      );
      if (unsafe)
        throw new TalentError(
          "TALENT_AI_OUTPUT_UNSAFE",
          "AI 提取结果包含不允许保存的字段或证据",
          { extractionId: failed.id },
        );
      return failed;
    }
  }
  async confirmAI(
    input: ServiceInput & {
      requestId: string;
      extractionId: string;
      workEducationExperience?: string;
      representativeAchievements?: string;
    },
  ) {
    await authorizeActor({ actor: input.actor, action: "talent.submit" });
    return this.repository.transaction(async (tx) => {
      await this.repository.lockRequest(tx, input.requestId).catch(() => {
        throw new TalentError("TALENT_REQUEST_NOT_FOUND", "人才申请不存在");
      });
      const request = await tx.talentChangeRequest.findUnique({
        where: { id: input.requestId },
      });
      if (!request)
        throw new TalentError("TALENT_REQUEST_NOT_FOUND", "人才申请不存在");
      if (request.requestType === "CORRECTION")
        await authorizeActor({
          actor: input.actor,
          action: "talent.correct_request",
        });
      if (request.submitterPersonId !== input.actor.personId)
        throw new TalentError(
          "TALENT_FORBIDDEN",
          "仅申请提交人可确认当前申请的提取结果",
        );
      if (
        request.status !== "PENDING_REVIEW" &&
        request.status !== "RETURNED"
      )
        throw new TalentError(
          "TALENT_REQUEST_STATE_CONFLICT",
          "当前申请状态不允许确认简历提取结果",
        );
      const extraction = await tx.talentAIExtraction.findUnique({
        where: { id: input.extractionId },
      });
      if (
        !extraction ||
        extraction.requestId !== request.id
      )
        throw new TalentError(
          "TALENT_FORBIDDEN",
          "仅申请提交人可确认当前申请的提取结果",
        );
      if (extraction.status !== "COMPLETED")
        throw new TalentError(
          "TALENT_STATE_CONFLICT",
          "只有提取成功的候选内容可以确认",
        );
      const accepted = {
        ...(input.workEducationExperience !== undefined
          ? { workEducationExperience: input.workEducationExperience }
          : {}),
        ...(input.representativeAchievements !== undefined
          ? { representativeAchievements: input.representativeAchievements }
          : {}),
      };
      const payload = request.payloadSnapshot as Record<string, unknown>;
      let updatedPayload: Prisma.InputJsonObject;
      if (request.requestType === "CREATE") {
        const parsed =
          createTalentChangeRequestSchema.options[0].shape.payload.parse(
            payload,
          );
        updatedPayload = { talent: { ...parsed.talent, ...accepted } };
      } else {
        const parsed =
          createTalentChangeRequestSchema.options[1].shape.payload.parse(
            payload,
          );
        updatedPayload = {
          ...parsed,
          changes: { ...parsed.changes, ...accepted },
        };
      }
      await tx.talentChangeRequest.update({
        where: { id: request.id },
        data: { payloadSnapshot: updatedPayload },
      });
      const confirmed = await tx.talentAIExtraction.update({
        where: { id: extraction.id },
        data: {
          status: "CONFIRMED",
          confirmedAt: new Date(),
          confirmedByPersonId: input.actor.personId,
        },
      });
      await writeTalentAudit(tx, {
        ...input,
        actionCode: "TALENT_AI_EXTRACTION_CONFIRMED",
        entityType: "TALENT_AI_EXTRACTION",
        entityId: extraction.id,
        after: {
          requestId: request.id,
          extractionId: extraction.id,
          acceptedFields: Object.keys(accepted),
        },
      });
      return confirmed;
    });
  }
}
