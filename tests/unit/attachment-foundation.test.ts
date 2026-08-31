import { describe, expect, it, vi } from "vitest";
import { AttachmentError } from "@/modules/attachment/attachment-errors";
import { AttachmentScanService } from "@/modules/attachment/attachment-scan-service";
import { createAttachmentUploadTask } from "@/modules/attachment/client/cos-browser-uploader";
import { waitForAttachmentScan } from "@/modules/attachment/client/wait-for-attachment-scan";
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
import { ClamAvFileScanAdapter, FakeCleanScanner, UnavailableFileScanAdapter } from "@/modules/attachment/scan/file-scan-adapter";
import { createAttachmentStorageRuntime, createFileScanAdapter, testMemoryAttachmentStorageEnabled } from "@/modules/attachment/runtime";
import { buildCosUploadPolicy, CosStorageAdapter, COS_UPLOAD_ACTIONS } from "@/modules/attachment/storage/cos-storage-adapter";
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

  it("emits one phase summary without filename, content, object key, or hash", async () => {
    const repository = scanRepository();
    const storage = new InMemoryStorageAdapter();
    const content = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\nprivate-content");
    storage.putObjectForTest("attachments/2026/08/a/file", content);
    repository.findById.mockResolvedValue({
      ...await repository.findById(), actualSizeBytes: BigInt(content.byteLength),
      originalFilename: "private-name.pdf", objectKey: "attachments/2026/08/a/file",
    });
    const summaries: Record<string, unknown>[] = [];
    const service = new AttachmentScanService(
      repository as unknown as AttachmentRepository, storage, new FakeCleanScanner(),
      (entry) => summaries.push(entry),
    );
    await service.processAttachmentScan(attachmentId);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ result: "passed", attachmentId, repository_lookup_ms: expect.any(Number), clamav_scan_ms: expect.any(Number), total_ms: expect.any(Number) });
    const serialized = JSON.stringify(summaries);
    expect(serialized).not.toContain("private-name.pdf");
    expect(serialized).not.toContain("private-content");
    expect(serialized).not.toContain("attachments/2026/08/a/file");
    expect(serialized).not.toContain(sha256(content));
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

  it("keeps a lost terminal DB acknowledgement retryable without downgrading a terminal row", async () => {
    const repository = scanRepository();
    const storage = new InMemoryStorageAdapter();
    const content = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
    storage.putObjectForTest("attachments/2026/08/a/file", content);
    repository.findById.mockResolvedValue({ ...await repository.findById(), actualSizeBytes: BigInt(content.byteLength) });
    repository.markScanPassed.mockRejectedValueOnce(new Error("DB_ACK_LOST"));
    const service = new AttachmentScanService(repository as unknown as AttachmentRepository, storage, new FakeCleanScanner());

    await expect(service.processAttachmentScan(attachmentId)).rejects.toThrow("DB_ACK_LOST");
    expect(repository.markScanFailed).toHaveBeenCalledWith(attachmentId, "SCAN_PROCESSING_FAILED");
  });
});

describe("M3-008 explicit attachment scanner selection", () => {
  it("never selects a fake from APP_ENV and requires an explicit ClamAV provider", () => {
    expect(createFileScanAdapter({ APP_ENV: "test" })).toBeInstanceOf(UnavailableFileScanAdapter);
    expect(createFileScanAdapter({ APP_ENV: "test", FILE_SCAN_PROVIDER: "clamav", CLAMAV_HOST: "127.0.0.1", CLAMAV_PORT: "3310" }))
      .toBeInstanceOf(ClamAvFileScanAdapter);
    expect(createFileScanAdapter({ APP_ENV: "test", FILE_SCAN_PROVIDER: "clamav", CLAMAV_HOST: "" }))
      .toBeInstanceOf(UnavailableFileScanAdapter);
  });

  it("waits for PASSED and rejects terminal non-clean states before returning an attachment id", async () => {
    const states = ["PENDING", "SCANNING", "PASSED"];
    const readState = vi.fn(async () => ({ scanStatus: states.shift() ?? "PASSED" }));
    await expect(waitForAttachmentScan(readState, { intervalMs: 0, timeoutMs: 1_000 })).resolves.toBeUndefined();
    expect(readState).toHaveBeenCalledTimes(3);
    await expect(waitForAttachmentScan(async () => ({ scanStatus: "REJECTED" }), { intervalMs: 0 }))
      .rejects.toThrow("文件安全扫描未通过");
  });
});

describe("on-demand explicit attachment storage selection", () => {
  const base = {
    COS_BUCKET: "unit-private-bucket-1250000000",
    COS_REGION: "ap-test",
  };

  it("does not derive memory storage from APP_ENV=test or silently fall back when Provider is missing", () => {
    expect(testMemoryAttachmentStorageEnabled({ APP_ENV: "test" })).toBe(false);
    expect(() => createAttachmentStorageRuntime({ ...base, APP_ENV: "test" }))
      .toThrowError(expect.objectContaining({ code: "ATTACHMENT_STORAGE_UNAVAILABLE" }));
    expect(() => createAttachmentStorageRuntime({ ...base, APP_ENV: "test", ATTACHMENT_STORAGE_PROVIDER: "memory" }))
      .toThrowError(expect.objectContaining({ code: "ATTACHMENT_STORAGE_UNAVAILABLE" }));
  });

  it("allows memory only behind the explicit non-production test gate", () => {
    const environment = {
      ...base,
      APP_ENV: "test",
      NODE_ENV: "test",
      ATTACHMENT_STORAGE_PROVIDER: "memory",
      ENABLE_TEST_MEMORY_ATTACHMENT_STORAGE: "true",
    };
    expect(testMemoryAttachmentStorageEnabled(environment)).toBe(true);
    expect(createAttachmentStorageRuntime(environment).storage).toBeInstanceOf(InMemoryStorageAdapter);
    expect(() => createAttachmentStorageRuntime({ ...environment, NODE_ENV: "production" }))
      .toThrowError(expect.objectContaining({ code: "ATTACHMENT_STORAGE_UNAVAILABLE" }));
  });

  it("makes separate deployed TEST processes select COS and rejects incomplete COS configuration", () => {
    const testCredentials = {
      ["COS_SECRET_ID"]: "test-only",
      ["COS_SECRET_KEY"]: "test-only",
    };
    const deployedTest = {
      ...base,
      ...testCredentials,
      APP_ENV: "test",
      NODE_ENV: "production",
      ATTACHMENT_STORAGE_PROVIDER: "cos",
    };
    const web = createAttachmentStorageRuntime(deployedTest);
    const scanJob = createAttachmentStorageRuntime(deployedTest);
    expect(web.storage).toBeInstanceOf(CosStorageAdapter);
    expect(scanJob.storage).toBeInstanceOf(CosStorageAdapter);
    expect({ bucket: web.storage.bucket, region: web.storage.region })
      .toEqual({ bucket: scanJob.storage.bucket, region: scanJob.storage.region });
    expect(() => createAttachmentStorageRuntime({ ...deployedTest, ["COS_SECRET_KEY"]: "" }))
      .toThrowError(expect.objectContaining({ code: "ATTACHMENT_STORAGE_UNAVAILABLE" }));
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

  it("grants only the advanced-upload actions on one exact staging object", () => {
    const objectKey = createStagingObjectKey(attachmentId, "0123456789abcdef");
    const otherObjectKey = createStagingObjectKey("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "fedcba9876543210");
    const policy = buildCosUploadPolicy({
      bucket: "private-1250000000",
      region: "ap-shanghai",
      objectKey,
    });
    const serialized = JSON.stringify(policy);
    expect(policy.statement).toHaveLength(1);
    expect(policy.statement[0].action).toEqual([...COS_UPLOAD_ACTIONS]);
    expect(policy.statement[0].action).toContain("name/cos:HeadObject");
    expect(policy.statement[0].action).toContain("name/cos:ListMultipartUploads");
    expect(policy.statement[0].resource).toContain(objectKey);
    expect(policy.statement[0].resource.endsWith(`/${objectKey}`)).toBe(true);
    expect(policy.statement[0].resource).not.toBe("*");
    expect(serialized).not.toContain(`${objectKey}*`);
    expect(serialized).not.toContain(otherObjectKey);
    expect(serialized).not.toContain("attachments/");
    for (const forbiddenAction of ["name/cos:GetObject", "name/cos:DeleteObject", "name/cos:PutObjectACL"]) {
      expect(policy.statement[0].action).not.toContain(forbiddenAction);
    }
  });

  it("honors the requested signed URL TTL", async () => {
    const storage = new InMemoryStorageAdapter();
    storage.putObjectForTest("attachments/a", Buffer.from("content"));
    await expect(storage.createSignedGetUrl("attachments/a", 300)).resolves.toContain("expires=300");
  });
});

describe("M0-005 browser upload task controls", () => {
  it("defers pre-ready controls and exposes pause, resume and terminal cancel", async () => {
    let onTaskReady: ((id: string) => void) | undefined;
    let finishUpload: (() => void) | undefined;
    const uploadPromise = new Promise<void>((resolve) => { finishUpload = resolve; });
    const client = {
      uploadFile: vi.fn((params: { onTaskReady?: (id: string) => void }) => {
        onTaskReady = params.onTaskReady;
        return uploadPromise;
      }),
      pauseTask: vi.fn(),
      restartTask: vi.fn(),
      cancelTask: vi.fn(),
    };
    const task = createAttachmentUploadTask(
      client as unknown as Parameters<typeof createAttachmentUploadTask>[0],
      {
        Bucket: "private-1250000000",
        Region: "ap-shanghai",
        Key: `incoming/${attachmentId}/file`,
        Body: new Blob(["content"]),
      },
    );

    expect(task.getTaskId()).toBeUndefined();
    task.pause();
    expect(client.pauseTask).not.toHaveBeenCalled();
    onTaskReady?.("task-1");
    expect(task.getTaskId()).toBe("task-1");
    expect(client.pauseTask).toHaveBeenCalledWith("task-1");

    task.resume();
    expect(client.restartTask).toHaveBeenCalledWith("task-1");
    task.cancel();
    expect(client.cancelTask).toHaveBeenCalledWith("task-1");
    task.resume();
    expect(client.restartTask).toHaveBeenCalledTimes(1);

    finishUpload?.();
    await task.promise;
  });

  it("safely applies cancel requested before task readiness", () => {
    let onTaskReady: ((id: string) => void) | undefined;
    const client = {
      uploadFile: vi.fn((params: { onTaskReady?: (id: string) => void }) => {
        onTaskReady = params.onTaskReady;
        return new Promise<void>(() => undefined);
      }),
      pauseTask: vi.fn(),
      restartTask: vi.fn(),
      cancelTask: vi.fn(),
    };
    const task = createAttachmentUploadTask(
      client as unknown as Parameters<typeof createAttachmentUploadTask>[0],
      {
        Bucket: "private-1250000000",
        Region: "ap-shanghai",
        Key: `incoming/${attachmentId}/file`,
        Body: new Blob(["content"]),
      },
    );

    task.cancel();
    expect(client.cancelTask).not.toHaveBeenCalled();
    onTaskReady?.("task-2");
    expect(client.cancelTask).toHaveBeenCalledWith("task-2");
    task.pause();
    task.resume();
    expect(client.pauseTask).not.toHaveBeenCalled();
    expect(client.restartTask).not.toHaveBeenCalled();
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
