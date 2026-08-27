import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RoleCode } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { AttachmentParentAuthorizerRegistry } from "@/modules/attachment";
import { resolveCapabilities, type PermissionActor } from "@/modules/permissions";
import { FakePolicyExtractionAdapter, PolicyRepository, PolicyService, registerPolicyAttachmentAuthorizer } from "@/modules/policy";

const prisma = getPrismaClient(); const personIds: string[] = []; const accountIds: string[] = []; const attachmentIds: string[] = []; const policyIds: string[] = []; const tagIds: string[] = [];
let admin: PermissionActor; let member: PermissionActor; let minister: PermissionActor; let tagId: string;

async function actor(role: RoleCode) {
  const person = await prisma.person.create({ data: { name: `M2-006 ${role} ${randomUUID()}` } }); personIds.push(person.id);
  const account = await prisma.account.create({ data: { personId: person.id, phone: `137${Math.floor(10_000_000 + Math.random() * 89_999_999)}`, passwordHash: "test", status: "NORMAL" } }); accountIds.push(account.id);
  const roles = [role]; return { personId: person.id, accountId: account.id, accountStatus: "NORMAL" as const, effectiveRoles: roles, capabilities: resolveCapabilities(roles, new Set()), specialPermissions: new Set<string>(), selfPersonId: person.id, townshipAreaIds: [], departmentAreaIds: [], hasGlobalPublished: true, hasGlobalOperational: role === "ADMIN" || role === "SUPER_ADMIN", hasSystem: role === "SUPER_ADMIN", currentBatchMember: role === "MEMBER_CURRENT", configurationIssues: [], permissionVersion: BigInt(1) } satisfies PermissionActor;
}

async function attachment(owner = admin.personId) {
  const id = randomUUID(); attachmentIds.push(id);
  await prisma.attachment.create({ data: { id, originalFilename: `${id}.pdf`, extension: "pdf", declaredMimeType: "application/pdf", detectedMimeType: "application/pdf", detectedFileType: "pdf", expectedSizeBytes: 100, actualSizeBytes: 100, sha256: "a".repeat(64), bucket: "test", region: "test", objectKey: `policy/${id}.pdf`, uploadStatus: "UPLOADED", scanStatus: "PASSED", uploadedByPersonId: owner } });
  return id;
}
function input(primaryAttachmentId: string, suffix = randomUUID()) { return { title: `政策-${suffix}`, issuingDepartment: "宝应县测试部门", publicationDate: "2026-08-27", level: "县级", applicationDeadline: null, tagIds: [tagId], primaryAttachmentId, supplementaryAttachmentIds: [], content: {} }; }
function interpretation() { return { targetAudience: "县内企业", supportContent: "专项支持", applicationConditions: "依法经营", keyClauses: ["第一条"], evidence: [{ field: "支持内容", value: "专项支持", page: 1, locator: "第一条" }] }; }
function service() { return new PolicyService(new PolicyRepository(), new FakePolicyExtractionAdapter()); }

async function draft() { const created = await service().create({ actor: admin, policy: input(await attachment()) }); policyIds.push(created.id); return created; }
async function publish() { const created = await draft(); const detail = await service().detail({ actor: admin, policyId: created.id }); await service().confirmInterpretation({ actor: admin, policyId: created.id, core: { title: created.title, issuingDepartment: created.issuingDepartment, publicationDate: "2026-08-27", level: created.level, applicationDeadline: null, tagIds: [tagId] }, interpretation: interpretation() }); await service().publish({ actor: admin, policyId: created.id }); return { ...created, versionId: detail.currentVersionId! }; }

beforeAll(async () => {
  [admin, member, minister] = await Promise.all([actor("ADMIN"), actor("MEMBER_CURRENT"), actor("MINISTER")]);
  const tag = await prisma.policyTag.create({ data: { name: `科技创新-${randomUUID()}`, normalizedName: randomUUID() } }); tagId = tag.id; tagIds.push(tag.id);
});

afterAll(async () => {
  await prisma.policy.updateMany({ where: { id: { in: policyIds } }, data: { currentVersionId: null } });
  await prisma.attachmentLink.deleteMany({ where: { entityType: "POLICY_CONTENT_VERSION", entityId: { in: (await prisma.policyContentVersion.findMany({ where: { policyId: { in: policyIds } }, select: { id: true } })).map(({ id }) => id) } } });
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

  it("authorizes draft files only for admin and published files for ordinary internal users", async () => {
    const created = await draft(); const versionId = (await prisma.policy.findUniqueOrThrow({ where: { id: created.id } })).currentVersionId!; const registry = new AttachmentParentAuthorizerRegistry(); registerPolicyAttachmentAuthorizer(registry); const links = [{ entityType: "POLICY_CONTENT_VERSION", entityId: versionId, relationType: "PRIMARY" }];
    await expect(registry.authorizeAll({ actor: member, links, action: "PREVIEW" })).resolves.toBe(false); await expect(registry.authorizeAll({ actor: admin, links, action: "PREVIEW" })).resolves.toBe(true);
    await service().confirmInterpretation({ actor: admin, policyId: created.id, core: { title: created.title, issuingDepartment: created.issuingDepartment, publicationDate: "2026-08-27", level: created.level, applicationDeadline: null, tagIds: [tagId] }, interpretation: interpretation() }); await service().publish({ actor: admin, policyId: created.id });
    await expect(registry.authorizeAll({ actor: member, links, action: "PREVIEW" })).resolves.toBe(true); await expect(registry.authorizeAll({ actor: minister, links, action: "DOWNLOAD" })).resolves.toBe(true);
  });

  it("prevents replacement cycles/conflicts and never auto-restores on withdraw", async () => {
    const [oldPolicy, newPolicy, competing] = await Promise.all([publish(), publish(), publish()]);
    const race = await Promise.allSettled([service().createReplacement({ actor: admin, newPolicyId: newPolicy.id, oldPolicyId: oldPolicy.id, reason: "正式替代" }), service().createReplacement({ actor: admin, newPolicyId: competing.id, oldPolicyId: oldPolicy.id, reason: "并发冲突" })]);
    expect(race.filter(({ status }) => status === "fulfilled")).toHaveLength(1); const relation = await prisma.policyReplacementRelation.findFirstOrThrow({ where: { oldPolicyId: oldPolicy.id, endedAt: null } });
    await expect(service().createReplacement({ actor: admin, newPolicyId: oldPolicy.id, oldPolicyId: relation.newPolicyId, reason: "形成环" })).rejects.toMatchObject({ code: "POLICY_REPLACEMENT_CYCLE" });
    await service().withdraw({ actor: admin, policyId: relation.newPolicyId, reason: "发布错误" }); expect((await prisma.policy.findUniqueOrThrow({ where: { id: oldPolicy.id } })).effectStatus).toBe("REPLACED");
    await service().endReplacement({ actor: admin, relationId: relation.id, reason: "解除但不恢复", restoreOldAsCurrent: false }); expect((await prisma.policy.findUniqueOrThrow({ where: { id: oldPolicy.id } })).effectStatus).toBe("REPLACED");
    const restoredNew = await publish(); const second = await service().createReplacement({ actor: admin, newPolicyId: restoredNew.id, oldPolicyId: oldPolicy.id, reason: "再次替代" }); await service().endReplacement({ actor: admin, relationId: second.id, reason: "有正式依据恢复", restoreOldAsCurrent: true }); expect((await prisma.policy.findUniqueOrThrow({ where: { id: oldPolicy.id } })).effectStatus).toBe("CURRENT");
  });

  it("keeps withdraw versus replacement races in a legal final state", async () => {
    const [oldPolicy, newPolicy] = await Promise.all([publish(), publish()]); const results = await Promise.allSettled([service().withdraw({ actor: admin, policyId: newPolicy.id, reason: "并发撤回" }), service().createReplacement({ actor: admin, newPolicyId: newPolicy.id, oldPolicyId: oldPolicy.id, reason: "并发替代" })]);
    expect(results.some(({ status }) => status === "fulfilled")).toBe(true); const [oldAfter, newAfter] = await Promise.all([prisma.policy.findUniqueOrThrow({ where: { id: oldPolicy.id } }), prisma.policy.findUniqueOrThrow({ where: { id: newPolicy.id } })]);
    if (oldAfter.effectStatus === "REPLACED") expect(newAfter.publicationStatus).toBe("WITHDRAWN"); else expect(oldAfter.effectStatus).toBe("CURRENT");
  });
});
