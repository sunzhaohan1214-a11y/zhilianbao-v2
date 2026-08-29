import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { getPrismaClient } from "@/lib/db/prisma";
import { AttachmentCleanupService } from "@/modules/attachment/attachment-cleanup-service";
import { AttachmentRecoveryService } from "@/modules/attachment/attachment-recovery-service";
import { AttachmentLinkService } from "@/modules/attachment/attachment-link-service";
import { AttachmentScanService } from "@/modules/attachment/attachment-scan-service";
import { AttachmentService } from "@/modules/attachment/attachment-service";
import { MAX_ATTACHMENT_SIZE_BYTES, sha256 } from "@/modules/attachment/file-policy";
import { AttachmentParentAuthorizerRegistry } from "@/modules/attachment/parent-authorization";
import { AttachmentRepository } from "@/modules/attachment/repository/attachment-repository";
import {
  FakeCleanScanner,
  FakeMalwareScanner,
  type FileScanAdapter,
  UnavailableFileScanAdapter,
} from "@/modules/attachment/scan/file-scan-adapter";
import { InMemoryStorageAdapter } from "@/modules/attachment/storage/in-memory-storage-adapter";
import { resolveCapabilities } from "@/modules/permissions/role-capabilities";
import type { PermissionActor } from "@/modules/permissions/types";

const prisma = getPrismaClient();
const personIds: string[] = [];
const attachmentIds: string[] = [];
const areaIds: string[] = [];
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
    cleanupService: new AttachmentCleanupService(repository, storage),
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
  await prisma.administrativeArea.deleteMany({ where: { id: { in: areaIds } } });
  await prisma.$disconnect();
});

describe("M0-005 attachment lifecycle on real MySQL", () => {
  it("keeps internal scans safe while cleaning only abandoned public uploads", async () => {
    const actor = await createActor("cleanup-boundaries");
    const runtime = services();
    const recovery = new AttachmentRecoveryService();
    const expiredAt = new Date(Date.now() - 60_000);
    const area = await prisma.administrativeArea.create({ data: { name: `附件公开区域-${randomUUID()}`, type: "TOWNSHIP" } });
    areaIds.push(area.id);

    async function createExpired(input: { public: boolean; scanStatus: "PASSED" | "SCANNING" | "REJECTED" | "FAILED" }) {
      const attachment = await prisma.attachment.create({ data: {
        originalFilename: `cleanup-${randomUUID()}.pdf`,
        extension: "pdf",
        declaredMimeType: "application/pdf",
        expectedSizeBytes: BigInt(PDF.byteLength),
        actualSizeBytes: BigInt(PDF.byteLength),
        bucket: config.bucket,
        region: config.region,
        objectKey: `cleanup/${randomUUID()}.pdf`,
        uploadStatus: "UPLOADED",
        scanStatus: input.scanStatus,
        isTemporary: true,
        uploadExpiresAt: expiredAt,
        uploadedByPersonId: input.public ? null : actor.personId,
        publicUploadTokenHash: input.public ? randomUUID().replaceAll("-", "").repeat(2) : null,
        publicAreaId: input.public ? area.id : null,
      } });
      attachmentIds.push(attachment.id);
      return attachment;
    }

    const internalPassed = await createExpired({ public: false, scanStatus: "PASSED" });
    const internalScanning = await createExpired({ public: false, scanStatus: "SCANNING" });
    const publicPassed = await createExpired({ public: true, scanStatus: "PASSED" });
    const publicRejected = await createExpired({ public: true, scanStatus: "REJECTED" });
    const publicScanning = await createExpired({ public: true, scanStatus: "SCANNING" });
    const linkedPublic = await createExpired({ public: true, scanStatus: "PASSED" });
    await prisma.attachmentLink.create({ data: {
      attachmentId: linkedPublic.id,
      entityType: "TEST_RESOURCE",
      entityId: randomUUID(),
      relationType: "FILE",
    } });
    await prisma.attachment.update({ where: { id: linkedPublic.id }, data: { isTemporary: false } });

    await expect(runtime.cleanupService.cleanupExpiredTemporaryAttachments()).resolves.toBeGreaterThanOrEqual(2);
    expect((await prisma.attachment.findUniqueOrThrow({ where: { id: internalPassed.id } })).uploadStatus).toBe("UPLOADED");
    expect((await prisma.attachment.findUniqueOrThrow({ where: { id: internalScanning.id } })).scanStatus).toBe("SCANNING");
    expect((await prisma.attachment.findUniqueOrThrow({ where: { id: publicPassed.id } })).uploadStatus).toBe("ABORTED");
    expect((await prisma.attachment.findUniqueOrThrow({ where: { id: publicRejected.id } })).uploadStatus).toBe("ABORTED");
    expect((await prisma.attachment.findUniqueOrThrow({ where: { id: publicScanning.id } })).scanStatus).toBe("SCANNING");
    expect((await prisma.attachment.findUniqueOrThrow({ where: { id: linkedPublic.id } })).uploadStatus).toBe("UPLOADED");

    await prisma.$transaction((tx) => recovery.recoverStaleScan(tx, publicScanning.id));
    await expect(runtime.cleanupService.cleanupExpiredTemporaryAttachments()).resolves.toBeGreaterThanOrEqual(1);
    expect((await prisma.attachment.findUniqueOrThrow({ where: { id: publicScanning.id } })).uploadStatus).toBe("ABORTED");
  });

  it("rejects an expired 256-bit public upload token before complete", async () => {
    const runtime = services();
    const area = await prisma.administrativeArea.create({ data: { name: `附件凭证区域-${randomUUID()}`, type: "TOWNSHIP" } });
    areaIds.push(area.id);
    const intent = await runtime.service.createPublicUploadIntent({
      filename: "public.pdf",
      declaredMimeType: "application/pdf",
      expectedSizeBytes: PDF.byteLength,
      responsibleAreaId: area.id,
    });
    attachmentIds.push(intent.attachmentId);
    runtime.storage.putObjectForTest(intent.stagingObjectKey, PDF);
    await prisma.attachment.update({ where: { id: intent.attachmentId }, data: { uploadExpiresAt: new Date(Date.now() - 1) } });
    await expect(runtime.service.completePublic({ attachmentId: intent.attachmentId, uploadToken: intent.uploadToken }))
      .rejects.toMatchObject({ code: "ATTACHMENT_FORBIDDEN", status: 403 });
    expect((await prisma.attachment.findUniqueOrThrow({ where: { id: intent.attachmentId } })).uploadStatus).toBe("PENDING_UPLOAD");
  });

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

  it("authorizes attachment objects before exposing state and keeps failed access side-effect free", async () => {
    const owner = await createActor("access-order-owner");
    const denied = await createActor("access-order-denied");
    const registry = new AttachmentParentAuthorizerRegistry();
    registry.register("TEST_RESOURCE", { authorize: ({ actor }) => actor.personId === owner.personId });
    const runtime = services(new FakeCleanScanner(), registry);
    const signedUrl = vi.spyOn(runtime.storage, "createSignedGetUrl");

    const temporaryPending = await intentAndUpload({ actor: owner, service: runtime.service, storage: runtime.storage });
    await runtime.service.complete({ actor: owner, attachmentId: temporaryPending.attachmentId });
    await expect(runtime.service.access({
      actor: owner,
      attachmentId: temporaryPending.attachmentId,
      action: "PREVIEW",
      context: requestContext(),
    })).rejects.toMatchObject({ code: "ATTACHMENT_STATE_CONFLICT", status: 409 });
    await expect(runtime.service.access({
      actor: denied,
      attachmentId: temporaryPending.attachmentId,
      action: "PREVIEW",
      context: requestContext(),
    })).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE", status: 403 });
    expect(signedUrl).not.toHaveBeenCalled();
    expect(await prisma.attachmentAccessLog.count({ where: { attachmentId: temporaryPending.attachmentId } })).toBe(0);

    const temporaryRejected = await intentAndUpload({
      actor: owner,
      service: runtime.service,
      storage: runtime.storage,
      content: Buffer.from("MZ disguised executable"),
    });
    await runtime.service.complete({ actor: owner, attachmentId: temporaryRejected.attachmentId });
    await runtime.scanService.processAttachmentScan(temporaryRejected.attachmentId);
    await expect(runtime.service.access({
      actor: owner,
      attachmentId: temporaryRejected.attachmentId,
      action: "DOWNLOAD",
      context: requestContext(),
    })).rejects.toMatchObject({ code: "ATTACHMENT_STATE_CONFLICT", status: 409 });
    await expect(runtime.service.access({
      actor: denied,
      attachmentId: temporaryRejected.attachmentId,
      action: "DOWNLOAD",
      context: requestContext(),
    })).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE", status: 403 });
    expect(signedUrl).not.toHaveBeenCalled();
    expect(await prisma.attachmentAccessLog.count({ where: { attachmentId: temporaryRejected.attachmentId } })).toBe(0);

    const temporaryPassed = await intentAndUpload({ actor: owner, service: runtime.service, storage: runtime.storage });
    await runtime.service.complete({ actor: owner, attachmentId: temporaryPassed.attachmentId });
    await runtime.scanService.processAttachmentScan(temporaryPassed.attachmentId);
    await expect(runtime.service.access({
      actor: owner,
      attachmentId: temporaryPassed.attachmentId,
      action: "DOWNLOAD",
      context: requestContext(),
    })).resolves.toMatchObject({ ttlSeconds: 300 });
    await expect(runtime.service.access({
      actor: denied,
      attachmentId: temporaryPassed.attachmentId,
      action: "DOWNLOAD",
      context: requestContext(),
    })).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE", status: 403 });
    expect(signedUrl).toHaveBeenCalledTimes(1);
    expect(await prisma.attachmentAccessLog.count({ where: { attachmentId: temporaryPassed.attachmentId } })).toBe(1);
    signedUrl.mockClear();

    const linkedPending = await intentAndUpload({ actor: owner, service: runtime.service, storage: runtime.storage });
    await runtime.service.complete({ actor: owner, attachmentId: linkedPending.attachmentId });
    await expect(runtime.linkService.linkAttachment({
      attachmentId: linkedPending.attachmentId,
      entityType: "TEST_RESOURCE",
      entityId: randomUUID(),
      relationType: "FILE",
      authorizedDomainActorPersonId: owner.personId,
    })).rejects.toMatchObject({ code: "ATTACHMENT_STATE_CONFLICT" });
    expect((await prisma.attachment.findUniqueOrThrow({ where: { id: linkedPending.attachmentId } })).isTemporary).toBe(true);
    await expect(runtime.service.access({
      actor: owner,
      attachmentId: linkedPending.attachmentId,
      action: "PREVIEW",
      context: requestContext(),
    })).rejects.toMatchObject({ code: "ATTACHMENT_STATE_CONFLICT", status: 409 });
    await expect(runtime.service.access({
      actor: denied,
      attachmentId: linkedPending.attachmentId,
      action: "PREVIEW",
      context: requestContext(),
    })).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE", status: 403 });
    expect(signedUrl).not.toHaveBeenCalled();
    expect(await prisma.attachmentAccessLog.count({ where: { attachmentId: linkedPending.attachmentId } })).toBe(0);

    const linkedPassed = await intentAndUpload({ actor: owner, service: runtime.service, storage: runtime.storage });
    await runtime.service.complete({ actor: owner, attachmentId: linkedPassed.attachmentId });
    await runtime.scanService.processAttachmentScan(linkedPassed.attachmentId);
    await runtime.linkService.linkAttachment({
      attachmentId: linkedPassed.attachmentId,
      entityType: "TEST_RESOURCE",
      entityId: randomUUID(),
      relationType: "FILE",
      authorizedDomainActorPersonId: owner.personId,
    });
    await expect(runtime.service.access({
      actor: owner,
      attachmentId: linkedPassed.attachmentId,
      action: "DOWNLOAD",
      context: requestContext(),
    })).resolves.toMatchObject({ ttlSeconds: 300 });
    await expect(runtime.service.access({
      actor: denied,
      attachmentId: linkedPassed.attachmentId,
      action: "DOWNLOAD",
      context: requestContext(),
    })).rejects.toMatchObject({ code: "ATTACHMENT_FORBIDDEN", status: 403 });
    await expect(runtime.service.access({
      actor: { ...denied, hasSystem: true },
      attachmentId: linkedPassed.attachmentId,
      action: "DOWNLOAD",
      context: requestContext(),
    })).rejects.toMatchObject({ code: "ATTACHMENT_FORBIDDEN", status: 403 });
    expect(signedUrl).toHaveBeenCalledTimes(1);
    expect(await prisma.attachmentAccessLog.count({ where: { attachmentId: linkedPassed.attachmentId } })).toBe(1);
    signedUrl.mockRestore();
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

  it.each([99, 101])("fails and removes an actual %i-byte object declared as 100 bytes", async (actualSize) => {
    const actor = await createActor(`size-mismatch-${actualSize}`);
    const runtime = services();
    const intent = await runtime.service.createUploadIntent({
      actor,
      filename: "size-mismatch.pdf",
      declaredMimeType: "application/pdf",
      expectedSizeBytes: 100,
    });
    attachmentIds.push(intent.attachmentId);
    runtime.storage.putObjectForTest(intent.stagingObjectKey, Buffer.alloc(actualSize, 1));

    await expect(runtime.service.complete({ actor, attachmentId: intent.attachmentId }))
      .rejects.toMatchObject({ code: "ATTACHMENT_VALIDATION_FAILED", status: 422 });
    const failed = await prisma.attachment.findUniqueOrThrow({ where: { id: intent.attachmentId } });
    expect(failed).toMatchObject({
      uploadStatus: "FAILED",
      scanStatus: "FAILED",
      scanReason: "ACTUAL_SIZE_MISMATCH",
    });
    await expect(runtime.storage.headObject(intent.stagingObjectKey)).resolves.toEqual({ exists: false, sizeBytes: 0 });
    expect(await prisma.jobTask.count({ where: { idempotencyKey: `attachment-scan:${intent.attachmentId}` } })).toBe(0);
    await expect(runtime.service.complete({ actor, attachmentId: intent.attachmentId }))
      .rejects.toMatchObject({ code: "ATTACHMENT_STATE_CONFLICT" });
  });

  it("enforces link state gates while preserving failed links for abort and cleanup", async () => {
    const actor = await createActor("link-state-gate");
    const registry = new AttachmentParentAuthorizerRegistry();
    registry.register("TEST_RESOURCE", { authorize: ({ actor: accessActor }) => accessActor.personId === actor.personId });
    const runtime = services(new FakeCleanScanner(), registry);

    const pending = await intentAndUpload({ actor, service: runtime.service, storage: runtime.storage });
    await expect(runtime.linkService.linkAttachment({
      attachmentId: pending.attachmentId,
      entityType: "TEST_RESOURCE",
      entityId: randomUUID(),
      relationType: "FILE",
      authorizedDomainActorPersonId: actor.personId,
    })).rejects.toMatchObject({ code: "ATTACHMENT_STATE_CONFLICT" });
    expect((await prisma.attachment.findUniqueOrThrow({ where: { id: pending.attachmentId } })).isTemporary).toBe(true);
    await expect(runtime.service.abort({ actor, attachmentId: pending.attachmentId }))
      .resolves.toMatchObject({ uploadStatus: "ABORTED" });

    const cleanupCandidate = await intentAndUpload({ actor, service: runtime.service, storage: runtime.storage });
    await expect(runtime.linkService.linkAttachment({
      attachmentId: cleanupCandidate.attachmentId,
      entityType: "TEST_RESOURCE",
      entityId: randomUUID(),
      relationType: "FILE",
      authorizedDomainActorPersonId: actor.personId,
    })).rejects.toMatchObject({ code: "ATTACHMENT_STATE_CONFLICT" });
    await prisma.attachment.update({
      where: { id: cleanupCandidate.attachmentId },
      data: { uploadExpiresAt: new Date(Date.now() - 60_000) },
    });
    await expect(runtime.cleanupService.cleanupExpiredTemporaryAttachments()).resolves.toBeGreaterThanOrEqual(1);
    expect((await prisma.attachment.findUniqueOrThrow({ where: { id: cleanupCandidate.attachmentId } })).uploadStatus).toBe("ABORTED");
    await expect(runtime.storage.headObject(cleanupCandidate.stagingObjectKey)).resolves.toEqual({ exists: false, sizeBytes: 0 });

    const pendingScan = await intentAndUpload({ actor, service: runtime.service, storage: runtime.storage });
    await runtime.service.complete({ actor, attachmentId: pendingScan.attachmentId });
    await expect(runtime.linkService.linkAttachment({
      attachmentId: pendingScan.attachmentId,
      entityType: "TEST_RESOURCE",
      entityId: randomUUID(),
      relationType: "FILE",
      authorizedDomainActorPersonId: actor.personId,
    })).rejects.toMatchObject({ code: "ATTACHMENT_STATE_CONFLICT" });
    expect((await prisma.attachment.findUniqueOrThrow({ where: { id: pendingScan.attachmentId } })).isTemporary).toBe(true);
    await expect(runtime.service.access({
      actor,
      attachmentId: pendingScan.attachmentId,
      action: "PREVIEW",
      context: requestContext(),
    })).rejects.toMatchObject({ code: "ATTACHMENT_STATE_CONFLICT" });

    const scanning = await intentAndUpload({ actor, service: runtime.service, storage: runtime.storage });
    await runtime.service.complete({ actor, attachmentId: scanning.attachmentId });
    await expect(runtime.repository.beginScan(scanning.attachmentId)).resolves.toBe(true);
    await expect(runtime.linkService.linkAttachment({
      attachmentId: scanning.attachmentId,
      entityType: "TEST_RESOURCE",
      entityId: randomUUID(),
      relationType: "FILE",
      authorizedDomainActorPersonId: actor.personId,
    })).rejects.toMatchObject({ code: "ATTACHMENT_STATE_CONFLICT" });
    expect((await prisma.attachment.findUniqueOrThrow({ where: { id: scanning.attachmentId } })).isTemporary).toBe(true);

    const passed = await intentAndUpload({ actor, service: runtime.service, storage: runtime.storage });
    await runtime.service.complete({ actor, attachmentId: passed.attachmentId });
    await runtime.scanService.processAttachmentScan(passed.attachmentId);
    await expect(runtime.linkService.linkAttachment({
      attachmentId: passed.attachmentId,
      entityType: "TEST_RESOURCE",
      entityId: randomUUID(),
      relationType: "FILE",
      authorizedDomainActorPersonId: actor.personId,
    })).resolves.toMatchObject({ attachmentId: passed.attachmentId });
    expect((await prisma.attachment.findUniqueOrThrow({ where: { id: passed.attachmentId } })).isTemporary).toBe(false);

    const rejected = await intentAndUpload({
      actor,
      service: runtime.service,
      storage: runtime.storage,
      content: Buffer.from("MZ disguised executable"),
    });
    await runtime.service.complete({ actor, attachmentId: rejected.attachmentId });
    await runtime.scanService.processAttachmentScan(rejected.attachmentId);
    await expect(runtime.linkService.linkAttachment({
      attachmentId: rejected.attachmentId,
      entityType: "TEST_RESOURCE",
      entityId: randomUUID(),
      relationType: "FILE",
      authorizedDomainActorPersonId: actor.personId,
    })).rejects.toMatchObject({ code: "ATTACHMENT_STATE_CONFLICT" });
    expect((await prisma.attachment.findUniqueOrThrow({ where: { id: rejected.attachmentId } })).isTemporary).toBe(true);
    await prisma.attachment.update({
      where: { id: rejected.attachmentId },
      data: { uploadExpiresAt: new Date(Date.now() - 60_000) },
    });
    await expect(runtime.cleanupService.cleanupExpiredTemporaryAttachments()).resolves.toBe(1);
    expect((await prisma.attachment.findUniqueOrThrow({ where: { id: rejected.attachmentId } })).uploadStatus).toBe("ABORTED");

    const failedRuntime = services(new UnavailableFileScanAdapter());
    const scanFailed = await intentAndUpload({ actor, service: failedRuntime.service, storage: failedRuntime.storage });
    await failedRuntime.service.complete({ actor, attachmentId: scanFailed.attachmentId });
    await expect(failedRuntime.scanService.processAttachmentScan(scanFailed.attachmentId))
      .rejects.toMatchObject({ code: "ATTACHMENT_SCANNER_UNAVAILABLE" });
    await expect(failedRuntime.linkService.linkAttachment({
      attachmentId: scanFailed.attachmentId,
      entityType: "TEST_RESOURCE",
      entityId: randomUUID(),
      relationType: "FILE",
      authorizedDomainActorPersonId: actor.personId,
    })).rejects.toMatchObject({ code: "ATTACHMENT_STATE_CONFLICT" });
    expect((await prisma.attachment.findUniqueOrThrow({ where: { id: scanFailed.attachmentId } })).isTemporary).toBe(true);
    await expect(failedRuntime.service.abort({ actor, attachmentId: scanFailed.attachmentId }))
      .resolves.toMatchObject({ uploadStatus: "ABORTED" });
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
