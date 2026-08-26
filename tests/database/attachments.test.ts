import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getPrismaClient } from "@/lib/db/prisma";
import { AttachmentLinkService } from "@/modules/attachment/attachment-link-service";
import { AttachmentScanService } from "@/modules/attachment/attachment-scan-service";
import { AttachmentService } from "@/modules/attachment/attachment-service";
import { MAX_ATTACHMENT_SIZE_BYTES, sha256 } from "@/modules/attachment/file-policy";
import { AttachmentParentAuthorizerRegistry } from "@/modules/attachment/parent-authorization";
import { AttachmentRepository } from "@/modules/attachment/repository/attachment-repository";
import { FakeCleanScanner, FakeMalwareScanner, type FileScanAdapter } from "@/modules/attachment/scan/file-scan-adapter";
import { InMemoryStorageAdapter } from "@/modules/attachment/storage/in-memory-storage-adapter";
import { resolveCapabilities } from "@/modules/permissions/role-capabilities";
import type { PermissionActor } from "@/modules/permissions/types";

const prisma = getPrismaClient();
const personIds: string[] = [];
const attachmentIds: string[] = [];
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
const config = {
  bucket: "test-private-bucket-1250000000",
  region: "ap-test",
  uploadTtlSeconds: 900,
  signedUrlTtlSeconds: 300,
};

function requestContext() {
  return {
    ip: "127.0.0.1",
    deviceId: randomUUID(),
    deviceName: "DB Test",
    userAgent: "Vitest",
    requestId: randomUUID(),
  };
}

async function createActor(name: string): Promise<PermissionActor> {
  const person = await prisma.person.create({ data: { name: `M0-005 ${name} ${randomUUID()}` } });
  personIds.push(person.id);
  return {
    personId: person.id,
    accountId: randomUUID(),
    accountStatus: "NORMAL",
    permissionVersion: BigInt(1),
    effectiveRoles: [],
    capabilities: resolveCapabilities([], new Set()),
    specialPermissions: new Set(),
    selfPersonId: person.id,
    townshipAreaIds: [],
    departmentAreaIds: [],
    hasGlobalPublished: true,
    hasGlobalOperational: false,
    hasSystem: false,
    currentBatchMember: false,
    configurationIssues: [],
  };
}

function services(scanner: FileScanAdapter = new FakeCleanScanner(), registry = new AttachmentParentAuthorizerRegistry()) {
  const repository = new AttachmentRepository();
  const storage = new InMemoryStorageAdapter(config);
  return {
    repository,
    storage,
    registry,
    service: new AttachmentService(repository, storage, registry, config),
    scanService: new AttachmentScanService(repository, storage, scanner),
    linkService: new AttachmentLinkService(repository),
  };
}

async function intentAndUpload(input: {
  actor: PermissionActor;
  service: AttachmentService;
  storage: InMemoryStorageAdapter;
  content?: Buffer;
  filename?: string;
  mime?: string;
}) {
  const content = input.content ?? PDF;
  const intent = await input.service.createUploadIntent({
    actor: input.actor,
    filename: input.filename ?? "report.pdf",
    declaredMimeType: input.mime ?? "application/pdf",
    expectedSizeBytes: content.byteLength,
  });
  attachmentIds.push(intent.attachmentId);
  input.storage.putObjectForTest(intent.stagingObjectKey, content);
  return intent;
}

afterAll(async () => {
  if (attachmentIds.length > 0) {
    await prisma.attachmentAccessLog.deleteMany({ where: { attachmentId: { in: attachmentIds } } });
    await prisma.attachmentLink.deleteMany({ where: { attachmentId: { in: attachmentIds } } });
    await prisma.jobTask.deleteMany({ where: { idempotencyKey: { in: attachmentIds.map((id) => `attachment-scan:${id}`) } } });
    await prisma.stateTransitionHistory.deleteMany({ where: { entityType: "ATTACHMENT", entityId: { in: attachmentIds } } });
    await prisma.attachment.deleteMany({ where: { id: { in: attachmentIds } } });
  }
  await prisma.person.deleteMany({ where: { id: { in: personIds } } });
  await prisma.$disconnect();
});

describe("M0-005 attachment lifecycle on real MySQL", () => {
  it("runs intent -> complete -> pending gate -> clean scan -> access with SHA and AccessLog", async () => {
    const actor = await createActor("lifecycle");
    const runtime = services();
    const intent = await intentAndUpload({ actor, service: runtime.service, storage: runtime.storage });
    const completed = await runtime.service.complete({ actor, attachmentId: intent.attachmentId });
    expect(completed).toMatchObject({ uploadStatus: "UPLOADED", scanStatus: "PENDING", actualSizeBytes: PDF.byteLength });
    await expect(runtime.service.complete({ actor, attachmentId: intent.attachmentId })).resolves.toEqual(completed);
    await expect(runtime.service.access({ actor, attachmentId: intent.attachmentId, action: "PREVIEW", context: requestContext() }))
      .rejects.toMatchObject({ code: "ATTACHMENT_STATE_CONFLICT" });

    await expect(runtime.scanService.processAttachmentScan(intent.attachmentId)).resolves.toMatchObject({ scanStatus: "PASSED" });
    const access = await runtime.service.access({
      actor,
      attachmentId: intent.attachmentId,
      action: "DOWNLOAD",
      context: requestContext(),
    });
    expect(access.ttlSeconds).toBe(300);
    const stored = await prisma.attachment.findUniqueOrThrow({ where: { id: intent.attachmentId } });
    expect(stored.sha256).toBe(sha256(PDF));
    expect(stored.detectedFileType).toBe("pdf");
    expect(stored.objectKey).toMatch(/^attachments\/\d{4}\/\d{2}\//);
    expect(stored.objectKey).not.toContain("report.pdf");
    expect(await prisma.attachmentAccessLog.count({ where: { attachmentId: intent.attachmentId, action: "DOWNLOAD" } })).toBe(1);
    expect(await prisma.jobTask.count({ where: { idempotencyKey: `attachment-scan:${intent.attachmentId}` } })).toBe(1);
  });

  it("rejects intent over 50MB and rejects actual staging content over 50MB", async () => {
    const actor = await createActor("size");
    const runtime = services();
    await expect(runtime.service.createUploadIntent({
      actor,
      filename: "large.pdf",
      declaredMimeType: "application/pdf",
      expectedSizeBytes: MAX_ATTACHMENT_SIZE_BYTES + 1,
    })).rejects.toMatchObject({ code: "ATTACHMENT_TOO_LARGE" });

    const intent = await runtime.service.createUploadIntent({
      actor,
      filename: "declared-small.pdf",
      declaredMimeType: "application/pdf",
      expectedSizeBytes: 1,
    });
    attachmentIds.push(intent.attachmentId);
    runtime.storage.putObjectForTest(intent.stagingObjectKey, Buffer.alloc(MAX_ATTACHMENT_SIZE_BYTES + 1, 1));
    await expect(runtime.service.complete({ actor, attachmentId: intent.attachmentId }))
      .rejects.toMatchObject({ code: "ATTACHMENT_TOO_LARGE" });
    expect((await prisma.attachment.findUniqueOrThrow({ where: { id: intent.attachmentId } })).uploadStatus).toBe("FAILED");
  });

  it("rejects executable magic disguised as PDF and infected scanner results", async () => {
    const actor = await createActor("security");
    const disguised = services();
    const executable = Buffer.from("MZ this is not a PDF");
    const disguisedIntent = await intentAndUpload({
      actor,
      service: disguised.service,
      storage: disguised.storage,
      content: executable,
    });
    await disguised.service.complete({ actor, attachmentId: disguisedIntent.attachmentId });
    await expect(disguised.scanService.processAttachmentScan(disguisedIntent.attachmentId))
      .resolves.toMatchObject({ scanStatus: "REJECTED" });

    const infected = services(new FakeMalwareScanner());
    const infectedIntent = await intentAndUpload({ actor, service: infected.service, storage: infected.storage });
    await infected.service.complete({ actor, attachmentId: infectedIntent.attachmentId });
    await expect(infected.scanService.processAttachmentScan(infectedIntent.attachmentId))
      .resolves.toMatchObject({ scanStatus: "REJECTED" });
    const row = await prisma.attachment.findUniqueOrThrow({ where: { id: infectedIntent.attachmentId } });
    expect(row.scanReason).toBe("MALWARE_DETECTED");
    await expect(infected.service.access({ actor, attachmentId: infectedIntent.attachmentId, action: "DOWNLOAD", context: requestContext() }))
      .rejects.toMatchObject({ code: "ATTACHMENT_STATE_CONFLICT" });
  });

  it("prevents IDOR access and abort, while the owner can abort an unlinked temp attachment", async () => {
    const owner = await createActor("owner");
    const other = await createActor("other");
    const runtime = services();
    const intent = await intentAndUpload({ actor: owner, service: runtime.service, storage: runtime.storage });
    await runtime.service.complete({ actor: owner, attachmentId: intent.attachmentId });
    await runtime.scanService.processAttachmentScan(intent.attachmentId);
    await expect(runtime.service.access({ actor: other, attachmentId: intent.attachmentId, action: "DOWNLOAD", context: requestContext() }))
      .rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
    await expect(runtime.service.abort({ actor: other, attachmentId: intent.attachmentId }))
      .rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
    await expect(runtime.service.abort({ actor: owner, attachmentId: intent.attachmentId }))
      .resolves.toMatchObject({ uploadStatus: "ABORTED" });
  });

  it("denies abort after linking and fails closed for parent authorization", async () => {
    const owner = await createActor("linked-owner");
    const reader = await createActor("linked-reader");
    const registry = new AttachmentParentAuthorizerRegistry();
    registry.register("TEST_RESOURCE", { authorize: ({ link }) => link.entityId === "allowed-resource" });
    const runtime = services(new FakeCleanScanner(), registry);
    const intent = await intentAndUpload({ actor: owner, service: runtime.service, storage: runtime.storage });
    await runtime.service.complete({ actor: owner, attachmentId: intent.attachmentId });
    await runtime.scanService.processAttachmentScan(intent.attachmentId);
    await runtime.linkService.linkAttachment({
      attachmentId: intent.attachmentId,
      entityType: "TEST_RESOURCE",
      entityId: "allowed-resource",
      relationType: "SUPPORTING_FILE",
      authorizedDomainActorPersonId: owner.personId,
    });
    await expect(runtime.service.abort({ actor: owner, attachmentId: intent.attachmentId }))
      .rejects.toMatchObject({ code: "ATTACHMENT_FORBIDDEN" });
    await expect(runtime.service.access({ actor: reader, attachmentId: intent.attachmentId, action: "PREVIEW", context: requestContext() }))
      .resolves.toMatchObject({ ttlSeconds: 300 });

    const unknownRegistry = new AttachmentParentAuthorizerRegistry();
    const failClosed = new AttachmentService(runtime.repository, runtime.storage, unknownRegistry, config);
    await expect(failClosed.access({ actor: reader, attachmentId: intent.attachmentId, action: "DOWNLOAD", context: requestContext() }))
      .rejects.toMatchObject({ code: "ATTACHMENT_FORBIDDEN" });
    expect(await prisma.attachmentAccessLog.count({ where: { attachmentId: intent.attachmentId, personId: reader.personId } })).toBe(1);
  });
});
