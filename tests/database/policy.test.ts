import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AttachmentScanStatus, RoleCode } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { AttachmentParentAuthorizerRegistry } from "@/modules/attachment";
import { resolveCapabilities, type PermissionActor } from "@/modules/permissions";
import { FakePolicyExtractionAdapter, PolicyRepository, PolicyService, registerPolicyAttachmentAuthorizer } from "@/modules/policy";

const prisma = getPrismaClient(); const personIds: string[] = []; const accountIds: string[] = []; const attachmentIds: string[] = []; const policyIds: string[] = []; const tagIds: string[] = [];
let admin: PermissionActor; let adminB: PermissionActor; let member: PermissionActor; let minister: PermissionActor; let tagId: string;

async function actor(role: RoleCode) {
  const person = await prisma.person.create({ data: { name: `M2-006 ${role} ${randomUUID()}` } }); personIds.push(person.id);
  const account = await prisma.account.create({ data: { personId: person.id, phone: `137${Math.floor(10_000_000 + Math.random() * 89_999_999)}`, passwordHash: "test", status: "NORMAL" } }); accountIds.push(account.id);
  const roles = [role]; return { personId: person.id, accountId: account.id, accountStatus: "NORMAL" as const, effectiveRoles: roles, capabilities: resolveCapabilities(roles, new Set()), specialPermissions: new Set<string>(), selfPersonId: person.id, townshipAreaIds: [], departmentAreaIds: [], hasGlobalPublished: true, hasGlobalOperational: role === "ADMIN" || role === "SUPER_ADMIN", hasSystem: role === "SUPER_ADMIN", currentBatchMember: role === "MEMBER_CURRENT", configurationIssues: [], permissionVersion: BigInt(1) } satisfies PermissionActor;
}

async function attachment(owner = admin.personId, scanStatus: AttachmentScanStatus = "PASSED") {
  const id = randomUUID(); attachmentIds.push(id);
  await prisma.attachment.create({ data: { id, originalFilename: `${id}.pdf`, extension: "pdf", declaredMimeType: "application/pdf", detectedMimeType: "application/pdf", detectedFileType: "pdf", expectedSizeBytes: 100, actualSizeBytes: 100, sha256: "a".repeat(64), bucket: "test", region: "test", objectKey: `policy/${id}.pdf`, uploadStatus: "UPLOADED", scanStatus, isTemporary: true, uploadedByPersonId: owner } });
  return id;
}
function input(primaryAttachmentId: string, suffix = randomUUID()) { return { title: `政策-${suffix}`, issuingDepartment: "宝应县测试部门", publicationDate: "2026-08-27", level: "县级", applicationDeadline: null, tagIds: [tagId], primaryAttachmentId, supplementaryAttachmentIds: [], content: {} }; }
function interpretation(attachmentId?: string) { return { targetAudience: "县内企业", supportContent: "专项支持", applicationConditions: "依法经营", keyClauses: ["第一条"], evidence: [{ field: "支持内容", value: "专项支持", page: 1, locator: "第一条", ...(attachmentId ? { attachmentId } : {}) }] }; }
function service() { return new PolicyService(new PolicyRepository(), new FakePolicyExtractionAdapter()); }

async function draft() { const created = await service().create({ actor: admin, policy: input(await attachment()) }); policyIds.push(created.id); return created; }
async function publish() { const created = await draft(); const detail = await service().detail({ actor: admin, policyId: created.id }); await service().confirmInterpretation({ actor: admin, policyId: created.id, core: { title: created.title, issuingDepartment: created.issuingDepartment, publicationDate: "2026-08-27", level: created.level, applicationDeadline: null, tagIds: [tagId] }, interpretation: interpretation() }); await service().publish({ actor: admin, policyId: created.id }); return { ...created, versionId: detail.currentVersionId! }; }

beforeAll(async () => {
  [admin, adminB, member, minister] = await Promise.all([actor("ADMIN"), actor("ADMIN"), actor("MEMBER_CURRENT"), actor("MINISTER")]);
  const tag = await prisma.policyTag.create({ data: { name: `科技创新-${randomUUID()}`, normalizedName: randomUUID() } }); tagId = tag.id; tagIds.push(tag.id);
});

afterAll(async () => {
  await prisma.policy.updateMany({ where: { id: { in: policyIds } }, data: { currentVersionId: null } });
  await prisma.attachmentLink.deleteMany({ where: { entityType: "POLICY_CONTENT_VERSION", entityId: { in: (await prisma.policyContentVersion.findMany({ where: { policyId: { in: policyIds } }, select: { id: true } })).map(({ id }) => id) } } });
  await prisma.attachmentLink.deleteMany({ where: { attachmentId: { in: attachmentIds } } });
  await prisma.policyAIInterpretation.deleteMany({ where: { version: { policyId: { in: policyIds } } } });
  await prisma.policyReplacementRelation.deleteMany({ where: { OR: [{ oldPolicyId: { in: policyIds } }, { newPolicyId: { in: policyIds } }] } });
  await prisma.policyTagRelation.deleteMany({ where: { policyId: { in: policyIds } } });
  await prisma.policyContentVersion.deleteMany({ where: { policyId: { in: policyIds } } });
  await prisma.policy.deleteMany({ where: { id: { in: policyIds } } });
  await prisma.attachment.deleteMany({ where: { id: { in: attachmentIds } } });
  await prisma.policyTag.deleteMany({ where: { id: { in: tagIds } } });
  await prisma.auditLog.deleteMany({ where: { actorPersonId: { in: personIds } } }); await prisma.stateTransitionHistory.deleteMany({ where: { actorPersonId: { in: personIds } } });
  await prisma.account.deleteMany({ where: { id: { in: accountIds } } }); await prisma.person.deleteMany({ where: { id: { in: personIds } } }); await prisma.$disconnect();
});

describe("M2-006 real MySQL policy lifecycle", () => {
  it("enforces admin-only drafts, one primary, AI candidate boundary, manual confirm and publish", async () => {
    await expect(service().create({ actor: member, policy: input(await attachment(member.personId)) })).rejects.toMatchObject({ code: "FORBIDDEN_CAPABILITY" });
    const created = await draft();
    await expect(service().publish({ actor: admin, policyId: created.id })).rejects.toMatchObject({ code: "POLICY_CONFIRMATION_REQUIRED" });
    const extracted = await service().extract({ actor: admin, policyId: created.id }); expect(extracted.status).toBe("COMPLETED");
    expect((await prisma.policy.findUniqueOrThrow({ where: { id: created.id } })).title).toBe(created.title);
    await service().confirmInterpretation({ actor: admin, policyId: created.id, interpretationId: extracted.id, core: { title: "管理员确认名称", issuingDepartment: "管理员确认部门", publicationDate: "2026-08-27", level: "市级", applicationDeadline: null, tagIds: [tagId] }, interpretation: interpretation() });
    const outcomes = await Promise.allSettled([service().publish({ actor: admin, policyId: created.id }), service().publish({ actor: admin, policyId: created.id })]);
    expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(await prisma.attachmentLink.count({ where: { entityType: "POLICY_CONTENT_VERSION", entityId: (await prisma.policy.findUniqueOrThrow({ where: { id: created.id } })).currentVersionId!, relationType: "PRIMARY" } })).toBe(1);
    expect((await service().list({ actor: member, query: { page: 1, pageSize: 100 } })).items.some(({ id }) => id === created.id)).toBe(true);
  });

  it("serializes version numbers and permanently retains old attachment links", async () => {
    const created = await draft(); const oldVersionId = (await prisma.policy.findUniqueOrThrow({ where: { id: created.id } })).currentVersionId!; const first = { ...input(await attachment()), changeReason: "并发版本一" }; const second = { ...input(await attachment()), changeReason: "并发版本二" };
    const results = await Promise.all([service().createVersion({ actor: admin, policyId: created.id, version: first }), service().createVersion({ actor: admin, policyId: created.id, version: second })]);
    expect(results.map(({ versionNo }) => versionNo).sort()).toEqual([2, 3]); expect(await prisma.attachmentLink.count({ where: { entityType: "POLICY_CONTENT_VERSION", entityId: oldVersionId } })).toBe(1);
  });

  it("refuses policy links before PASSED while enforcing uploader ownership and row locks", async () => {
    const pendingAttachmentId = await attachment(admin.personId, "PENDING");
    await expect(service().create({ actor: admin, policy: input(pendingAttachmentId) }))
      .rejects.toMatchObject({ code: "POLICY_ATTACHMENT_NOT_READY" });
    expect(await prisma.attachmentLink.count({ where: { attachmentId: pendingAttachmentId } })).toBe(0);
    expect((await prisma.attachment.findUniqueOrThrow({ where: { id: pendingAttachmentId } })).isTemporary).toBe(true);
    await prisma.attachment.update({ where: { id: pendingAttachmentId }, data: { scanStatus: "PASSED" } });
    const pendingDraft = await service().create({ actor: admin, policy: input(pendingAttachmentId) }); policyIds.push(pendingDraft.id);
    await service().confirmInterpretation({ actor: admin, policyId: pendingDraft.id, core: { title: pendingDraft.title, issuingDepartment: pendingDraft.issuingDepartment, publicationDate: "2026-08-27", level: pendingDraft.level, applicationDeadline: null, tagIds: [tagId] }, interpretation: interpretation(pendingAttachmentId) });
    await expect(service().publish({ actor: admin, policyId: pendingDraft.id })).resolves.toMatchObject({ publicationStatus: "PUBLISHED" });

    const otherAdminAttachment = await attachment(adminB.personId);
    await expect(service().create({ actor: admin, policy: input(otherAdminAttachment) })).rejects.toMatchObject({ code: "POLICY_ATTACHMENT_NOT_READY" });
    for (const scanStatus of ["REJECTED", "FAILED"] as const) {
      const rejectedAttachment = await attachment(admin.personId, scanStatus);
      await expect(service().create({ actor: admin, policy: input(rejectedAttachment) })).rejects.toMatchObject({ code: "POLICY_ATTACHMENT_NOT_READY" });
    }

    const sharedAttachmentId = await attachment(); const sharedInput = input(sharedAttachmentId);
    const concurrent = await Promise.allSettled([service().create({ actor: admin, policy: sharedInput }), service().create({ actor: admin, policy: sharedInput })]);
    const fulfilled = concurrent.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<PolicyService["create"]>>> => result.status === "fulfilled");
    policyIds.push(...fulfilled.map(({ value }) => value.id)); expect(fulfilled).toHaveLength(1);
    expect(await prisma.attachmentLink.count({ where: { attachmentId: sharedAttachmentId } })).toBe(1);
  });

  it("shows ordinary users only the current published version and denies old draft attachments", async () => {
    const created = await draft(); const oldVersionId = (await prisma.policy.findUniqueOrThrow({ where: { id: created.id } })).currentVersionId!;
    await service().extract({ actor: admin, policyId: created.id });
    const currentAttachmentId = await attachment(); const currentVersion = await service().createVersion({ actor: admin, policyId: created.id, version: { ...input(currentAttachmentId), changeReason: "发布前纠正草稿" } });
    await service().confirmInterpretation({ actor: admin, policyId: created.id, core: { title: created.title, issuingDepartment: created.issuingDepartment, publicationDate: "2026-08-27", level: created.level, applicationDeadline: null, tagIds: [tagId] }, interpretation: interpretation(currentAttachmentId) });
    await service().publish({ actor: admin, policyId: created.id });
    const registry = new AttachmentParentAuthorizerRegistry(); registerPolicyAttachmentAuthorizer(registry);
    const oldLinks = [{ entityType: "POLICY_CONTENT_VERSION", entityId: oldVersionId, relationType: "PRIMARY" }]; const currentLinks = [{ entityType: "POLICY_CONTENT_VERSION", entityId: currentVersion.id, relationType: "PRIMARY" }];
    await expect(registry.authorizeAll({ actor: member, links: oldLinks, action: "PREVIEW" })).resolves.toBe(false);
    await expect(registry.authorizeAll({ actor: member, links: currentLinks, action: "PREVIEW" })).resolves.toBe(true);
    await expect(registry.authorizeAll({ actor: minister, links: currentLinks, action: "DOWNLOAD" })).resolves.toBe(true);
    await expect(registry.authorizeAll({ actor: admin, links: oldLinks, action: "DOWNLOAD" })).resolves.toBe(true);
    const ordinary = await service().detail({ actor: member, policyId: created.id }); const governance = await service().detail({ actor: admin, policyId: created.id });
    expect(ordinary.versions.map(({ id }) => id)).toEqual([currentVersion.id]); expect(ordinary.currentVersion?.interpretations).toEqual([]);
    expect(governance.versions).toHaveLength(2); expect(governance.versions.find(({ id }) => id === oldVersionId)?.interpretations).toHaveLength(1);
  });

  it("keeps confirmed versions append-only and validates evidence attachment ownership", async () => {
    const primaryAttachmentId = await attachment(); const created = await service().create({ actor: admin, policy: input(primaryAttachmentId) }); policyIds.push(created.id);
    const otherAttachmentId = await attachment(); const other = await service().create({ actor: admin, policy: input(otherAttachmentId) }); policyIds.push(other.id);
    const core = { title: "首次正式确认", issuingDepartment: created.issuingDepartment, publicationDate: "2026-08-27", level: created.level, applicationDeadline: null, tagIds: [tagId] };
    await expect(service().confirmInterpretation({ actor: admin, policyId: created.id, core, interpretation: interpretation(otherAttachmentId) })).rejects.toMatchObject({ code: "POLICY_EVIDENCE_ATTACHMENT_INVALID" });
    await expect(service().confirmInterpretation({ actor: admin, policyId: created.id, core, interpretation: interpretation(randomUUID()) })).rejects.toMatchObject({ code: "POLICY_EVIDENCE_ATTACHMENT_INVALID" });
    await service().confirmInterpretation({ actor: admin, policyId: created.id, core, interpretation: interpretation(primaryAttachmentId) });
    const v1 = await prisma.policyContentVersion.findFirstOrThrow({ where: { policyId: created.id, versionNo: 1 } }); const snapshotV1 = v1.snapshotJson;
    await expect(service().confirmInterpretation({ actor: admin, policyId: created.id, core: { ...core, title: "不得覆盖" }, interpretation: interpretation(primaryAttachmentId) })).rejects.toMatchObject({ code: "POLICY_VERSION_ALREADY_CONFIRMED", status: 409 });
    expect((await prisma.policyContentVersion.findUniqueOrThrow({ where: { id: v1.id } })).snapshotJson).toEqual(snapshotV1);
    const v2AttachmentId = await attachment(); const v2 = await service().createVersion({ actor: admin, policyId: created.id, version: { ...input(v2AttachmentId), title: "第二版", changeReason: "正式建立新版本" } });
    await expect(service().confirmInterpretation({ actor: admin, policyId: created.id, core: { ...core, title: "第二版" }, interpretation: interpretation(v2AttachmentId) })).resolves.toMatchObject({ versionId: v2.id });
  });

  it("prevents replacement cycles/conflicts and never auto-restores on withdraw", async () => {
    const [oldPolicy, newPolicy, competing] = await Promise.all([publish(), publish(), publish()]);
    const race = await Promise.allSettled([service().createReplacement({ actor: admin, newPolicyId: newPolicy.id, oldPolicyId: oldPolicy.id, reason: "正式替代" }), service().createReplacement({ actor: admin, newPolicyId: competing.id, oldPolicyId: oldPolicy.id, reason: "并发冲突" })]);
    expect(race.filter(({ status }) => status === "fulfilled")).toHaveLength(1); const relation = await prisma.policyReplacementRelation.findFirstOrThrow({ where: { oldPolicyId: oldPolicy.id, endedAt: null } });
    await expect(service().createReplacement({ actor: admin, newPolicyId: oldPolicy.id, oldPolicyId: relation.newPolicyId, reason: "形成环" })).rejects.toMatchObject({ code: "POLICY_REPLACEMENT_CYCLE" });
    await service().withdraw({ actor: admin, policyId: relation.newPolicyId, reason: "发布错误" }); expect((await prisma.policy.findUniqueOrThrow({ where: { id: oldPolicy.id } })).effectStatus).toBe("REPLACED");
    await service().endReplacement({ actor: admin, relationId: relation.id, reason: "解除但不恢复", restoreOldAsCurrent: false }); expect((await prisma.policy.findUniqueOrThrow({ where: { id: oldPolicy.id } })).effectStatus).toBe("REPLACED");
    const restorableOld = await publish(); const restoredNew = await publish(); const second = await service().createReplacement({ actor: admin, newPolicyId: restoredNew.id, oldPolicyId: restorableOld.id, reason: "正式替代" }); await service().endReplacement({ actor: admin, relationId: second.id, reason: "有正式依据恢复", restoreOldAsCurrent: true }); expect((await prisma.policy.findUniqueOrThrow({ where: { id: restorableOld.id } })).effectStatus).toBe("CURRENT");
  });

  it("enforces published-current replacement endpoints and atomic restore eligibility", async () => {
    const draftOld = await draft(); const publishedNew = await publish();
    await expect(service().createReplacement({ actor: admin, newPolicyId: publishedNew.id, oldPolicyId: draftOld.id, reason: "草稿不可替代" })).rejects.toMatchObject({ code: "POLICY_REPLACEMENT_INVALID" });
    const withdrawnOld = await publish(); await service().withdraw({ actor: admin, policyId: withdrawnOld.id, reason: "已撤回" });
    await expect(service().createReplacement({ actor: admin, newPolicyId: publishedNew.id, oldPolicyId: withdrawnOld.id, reason: "撤回不可替代" })).rejects.toMatchObject({ code: "POLICY_REPLACEMENT_INVALID" });

    const firstOld = await publish(); const firstNew = await publish(); await service().createReplacement({ actor: admin, newPolicyId: firstNew.id, oldPolicyId: firstOld.id, reason: "首次替代" });
    const unrelatedOld = await publish();
    await expect(service().createReplacement({ actor: admin, newPolicyId: firstOld.id, oldPolicyId: unrelatedOld.id, reason: "已被替代政策不能重新成为新政策" })).rejects.toMatchObject({ code: "POLICY_REPLACEMENT_INVALID" });

    const restoreOld = await publish(); const restoreNew = await publish(); const relation = await service().createReplacement({ actor: admin, newPolicyId: restoreNew.id, oldPolicyId: restoreOld.id, reason: "恢复前置关系" });
    await service().withdraw({ actor: admin, policyId: restoreOld.id, reason: "旧政策自身撤回" });
    await expect(service().endReplacement({ actor: admin, relationId: relation.id, reason: "不得恢复撤回政策", restoreOldAsCurrent: true })).rejects.toMatchObject({ code: "POLICY_REPLACEMENT_RESTORE_INVALID" });
    expect((await prisma.policyReplacementRelation.findUniqueOrThrow({ where: { id: relation.id } })).endedAt).toBeNull();
    expect((await prisma.policy.findUniqueOrThrow({ where: { id: restoreOld.id } })).effectStatus).toBe("REPLACED");
  });

  it("keeps withdraw versus replacement races in a legal final state", async () => {
    const [oldPolicy, newPolicy] = await Promise.all([publish(), publish()]); const results = await Promise.allSettled([service().withdraw({ actor: admin, policyId: newPolicy.id, reason: "并发撤回" }), service().createReplacement({ actor: admin, newPolicyId: newPolicy.id, oldPolicyId: oldPolicy.id, reason: "并发替代" })]);
    expect(results.some(({ status }) => status === "fulfilled")).toBe(true); const [oldAfter, newAfter] = await Promise.all([prisma.policy.findUniqueOrThrow({ where: { id: oldPolicy.id } }), prisma.policy.findUniqueOrThrow({ where: { id: newPolicy.id } })]);
    if (oldAfter.effectStatus === "REPLACED") expect(newAfter.publicationStatus).toBe("WITHDRAWN"); else expect(oldAfter.effectStatus).toBe("CURRENT");
  });
});
