import { describe, expect, it, vi } from "vitest";
import { AttachmentError } from "@/modules/attachment/attachment-errors";
import { AttachmentScanService } from "@/modules/attachment/attachment-scan-service";
import {
  inspectAttachmentContent,
  MAX_ATTACHMENT_SIZE_BYTES,
  normalizeFilename,
  sha256,
  validateIntentFile,
} from "@/modules/attachment/file-policy";
import { createStagingObjectKey, finalObjectKeyFromStaging } from "@/modules/attachment/object-keys";
import { AttachmentParentAuthorizerRegistry } from "@/modules/attachment/parent-authorization";
import type { AttachmentRepository } from "@/modules/attachment/repository/attachment-repository";
import { FakeCleanScanner, UnavailableFileScanAdapter } from "@/modules/attachment/scan/file-scan-adapter";
import { buildCosUploadPolicy, COS_UPLOAD_ACTIONS } from "@/modules/attachment/storage/cos-storage-adapter";
import { InMemoryStorageAdapter } from "@/modules/attachment/storage/in-memory-storage-adapter";
import type { PermissionActor } from "@/modules/permissions/types";

const attachmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function actor(): PermissionActor {
  return {
    personId: "person-a",
    accountId: "account-a",
    accountStatus: "NORMAL",
    permissionVersion: BigInt(1),
    effectiveRoles: [],
    capabilities: new Set(),
    specialPermissions: new Set(),
    selfPersonId: "person-a",
    townshipAreaIds: [],
    departmentAreaIds: [],
    hasGlobalPublished: true,
    hasGlobalOperational: false,
    hasSystem: false,
    currentBatchMember: false,
    configurationIssues: [],
  };
}

describe("M0-005 attachment file policy", () => {
  it("normalizes filename paths and keeps only a safe display name", () => {
    expect(normalizeFilename(" C:\\fakepath\\  report  2026.pdf ")).toBe("report 2026.pdf");
  });

  it("accepts the exact 50MB boundary and rejects the next byte", () => {
    expect(validateIntentFile({
      filename: "report.pdf",
      declaredMimeType: "application/pdf",
      expectedSizeBytes: MAX_ATTACHMENT_SIZE_BYTES,
    }).expectedSizeBytes).toBe(MAX_ATTACHMENT_SIZE_BYTES);
    expect(() => validateIntentFile({
      filename: "report.pdf",
      declaredMimeType: "application/pdf",
      expectedSizeBytes: MAX_ATTACHMENT_SIZE_BYTES + 1,
    })).toThrowError(expect.objectContaining({ code: "ATTACHMENT_TOO_LARGE" }));
  });

  it.each([
    ["report.pdf", "application/pdf"],
    ["letter.doc", "application/msword"],
    ["letter.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["table.xls", "application/vnd.ms-excel"],
    ["table.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["photo.jpg", "image/jpeg"],
    ["photo.jpeg", "image/jpeg"],
    ["image.png", "image/png"],
    ["camera.heic", "image/heic"],
    ["camera.heif", "image/heif"],
  ])("accepts allowlisted extension and declared MIME for %s", (filename, declaredMimeType) => {
    expect(validateIntentFile({ filename, declaredMimeType, expectedSizeBytes: 1 }))
      .toMatchObject({ declaredMimeType, expectedSizeBytes: 1 });
  });

  it("rejects executable extensions and mismatched declared MIME", () => {
    expect(() => validateIntentFile({
      filename: "payload.exe",
      declaredMimeType: "application/octet-stream",
      expectedSizeBytes: 100,
    })).toThrowError(expect.objectContaining({ code: "ATTACHMENT_TYPE_UNSUPPORTED" }));
    expect(() => validateIntentFile({
      filename: "report.pdf",
      declaredMimeType: "text/html",
      expectedSizeBytes: 100,
    })).toThrowError(expect.objectContaining({ code: "ATTACHMENT_TYPE_UNSUPPORTED" }));
  });

  it("uses magic bytes and rejects executable masquerading as PDF", async () => {
    await expect(inspectAttachmentContent({
      buffer: Buffer.from("MZ executable payload"),
      extension: "pdf",
      declaredMimeType: "application/pdf",
    })).rejects.toBeInstanceOf(AttachmentError);
    await expect(inspectAttachmentContent({
      buffer: Buffer.from("PK\u0003\u0004arbitrary zip"),
      extension: "docx",
      declaredMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    })).rejects.toMatchObject({ code: "ATTACHMENT_TYPE_UNSUPPORTED" });
  });

  it("computes the SHA-256 from actual bytes", () => {
    expect(sha256(Buffer.from("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("M0-005 scan transitions", () => {
  function scanRepository() {
    return {
      findById: vi.fn().mockResolvedValue({
        id: attachmentId,
        uploadStatus: "UPLOADED",
        scanStatus: "PENDING",
        objectKey: "attachments/2026/08/a/file",
        originalFilename: "report.pdf",
        extension: "pdf",
        declaredMimeType: "application/pdf",
        actualSizeBytes: BigInt(54),
      }),
      beginScan: vi.fn().mockResolvedValue(true),
      markScanPassed: vi.fn().mockResolvedValue(undefined),
      markScanRejected: vi.fn().mockResolvedValue(undefined),
      markScanFailed: vi.fn().mockResolvedValue(undefined),
    };
  }

  it("moves a clean final object from PENDING through SCANNING to PASSED", async () => {
    const repository = scanRepository();
    const storage = new InMemoryStorageAdapter();
    const content = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
    storage.putObjectForTest("attachments/2026/08/a/file", content);
    repository.findById.mockResolvedValue({
      ...await repository.findById(),
      actualSizeBytes: BigInt(content.byteLength),
    });
    const service = new AttachmentScanService(
      repository as unknown as AttachmentRepository,
      storage,
      new FakeCleanScanner(),
    );

    await expect(service.processAttachmentScan(attachmentId)).resolves.toMatchObject({ scanStatus: "PASSED" });
    expect(repository.beginScan).toHaveBeenCalledWith(attachmentId);
    expect(repository.markScanPassed).toHaveBeenCalledWith(expect.objectContaining({
      id: attachmentId,
      detectedFileType: "pdf",
      sha256: sha256(content),
    }));
  });

  it("keeps access fail-closed by recording FAILED when the scanner is unavailable", async () => {
    const repository = scanRepository();
    const storage = new InMemoryStorageAdapter();
    const content = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
    storage.putObjectForTest("attachments/2026/08/a/file", content);
    repository.findById.mockResolvedValue({
      ...await repository.findById(),
      actualSizeBytes: BigInt(content.byteLength),
    });
    const service = new AttachmentScanService(
      repository as unknown as AttachmentRepository,
      storage,
      new UnavailableFileScanAdapter(),
    );

    await expect(service.processAttachmentScan(attachmentId))
      .rejects.toMatchObject({ code: "ATTACHMENT_SCANNER_UNAVAILABLE" });
    expect(repository.markScanFailed).toHaveBeenCalledWith(attachmentId, "SCANNER_UNAVAILABLE");
    expect(repository.markScanPassed).not.toHaveBeenCalled();
  });
});

describe("M0-005 storage authorization and keys", () => {
  it("never includes the original filename in staging or immutable final keys", () => {
    const staging = createStagingObjectKey(attachmentId, "0123456789abcdef");
    const finalKey = finalObjectKeyFromStaging(attachmentId, new Date("2026-08-27T10:00:00Z"), staging);
    expect(staging).toBe(`incoming/${attachmentId}/0123456789abcdef`);
    expect(finalKey).toBe(`attachments/2026/08/${attachmentId}/0123456789abcdef`);
    expect(`${staging}${finalKey}`).not.toContain("report.pdf");
  });

  it("limits STS policy to one staging object without wildcard resources", () => {
    const objectKey = createStagingObjectKey(attachmentId, "0123456789abcdef");
    const policy = buildCosUploadPolicy({
      bucket: "private-1250000000",
      region: "ap-shanghai",
      objectKey,
    });
    const serialized = JSON.stringify(policy);
    expect(policy.statement).toHaveLength(1);
    expect(policy.statement[0].action).toEqual([...COS_UPLOAD_ACTIONS]);
    expect(policy.statement[0].resource).toContain(objectKey);
    expect(policy.statement[0].resource).not.toBe("*");
    expect(serialized).not.toContain(`${objectKey}*`);
  });

  it("honors the requested signed URL TTL", async () => {
    const storage = new InMemoryStorageAdapter();
    storage.putObjectForTest("attachments/a", Buffer.from("content"));
    await expect(storage.createSignedGetUrl("attachments/a", 300)).resolves.toContain("expires=300");
  });
});

describe("M0-005 parent authorization registry", () => {
  it("fails closed for unknown or denied parent types and allows registered parents", async () => {
    const registry = new AttachmentParentAuthorizerRegistry();
    const link = { entityType: "TEST_RESOURCE", entityId: "resource-a", relationType: "FILE" };
    await expect(registry.authorizeAll({ actor: actor(), links: [link], action: "DOWNLOAD" })).resolves.toBe(false);
    registry.register("TEST_RESOURCE", { authorize: ({ link: target }) => target.entityId === "resource-a" });
    await expect(registry.authorizeAll({ actor: actor(), links: [link], action: "DOWNLOAD" })).resolves.toBe(true);
    await expect(registry.authorizeAll({
      actor: actor(),
      links: [{ ...link, entityId: "resource-b" }],
      action: "DOWNLOAD",
    })).resolves.toBe(false);
  });
});
