import { loadAttachmentConfig } from "./attachment-config";
import { AttachmentCleanupService } from "./attachment-cleanup-service";
import { AttachmentLinkService } from "./attachment-link-service";
import { AttachmentScanService } from "./attachment-scan-service";
import { AttachmentService } from "./attachment-service";
import { AttachmentParentAuthorizerRegistry } from "./parent-authorization";
import { AttachmentRepository } from "./repository/attachment-repository";
import { FakeCleanScanner, UnavailableFileScanAdapter } from "./scan/file-scan-adapter";
import { CosStorageAdapter } from "./storage/cos-storage-adapter";
import { InMemoryStorageAdapter } from "./storage/in-memory-storage-adapter";
import type { StorageAdapter } from "./storage/storage-adapter";
import { registerPolicyAttachmentAuthorizer } from "@/modules/policy/attachment-authorizer";
import { registerDemandAttachmentAuthorizers } from "@/modules/demand/attachment-authorization";
import { registerTalentAttachmentAuthorizers } from "@/modules/talent/attachment-authorizer";

type AttachmentRuntime = {
  storage: StorageAdapter;
  repository: AttachmentRepository;
  service: AttachmentService;
  scanService: AttachmentScanService;
  linkService: AttachmentLinkService;
  cleanupService: AttachmentCleanupService;
  parentAuthorizers: AttachmentParentAuthorizerRegistry;
};

const globalRuntime = globalThis as typeof globalThis & { __zlbAttachmentRuntime?: AttachmentRuntime };

function createRuntime(): AttachmentRuntime {
  const isTest = process.env.APP_ENV === "test";
  const config = isTest
    ? {
        bucket: process.env.COS_BUCKET || "test-private-bucket-1250000000",
        region: process.env.COS_REGION || "ap-test",
        uploadTtlSeconds: 900,
        signedUrlTtlSeconds: 300,
      }
    : loadAttachmentConfig();
  const storage: StorageAdapter = isTest
    ? new InMemoryStorageAdapter(config)
    : new CosStorageAdapter({
        bucket: config.bucket,
        region: config.region,
        secretId: process.env.COS_SECRET_ID ?? "",
        secretKey: process.env.COS_SECRET_KEY ?? "",
      });
  const repository = new AttachmentRepository();
  const parentAuthorizers = new AttachmentParentAuthorizerRegistry();
  registerPolicyAttachmentAuthorizer(parentAuthorizers);
  registerDemandAttachmentAuthorizers(parentAuthorizers);
  registerTalentAttachmentAuthorizers(parentAuthorizers);
  const scanner = isTest ? new FakeCleanScanner() : new UnavailableFileScanAdapter();
  return {
    storage,
    repository,
    parentAuthorizers,
    service: new AttachmentService(repository, storage, parentAuthorizers, config),
    scanService: new AttachmentScanService(repository, storage, scanner),
    linkService: new AttachmentLinkService(repository),
    cleanupService: new AttachmentCleanupService(repository, storage),
  };
}

export function getAttachmentRuntime(): AttachmentRuntime {
  globalRuntime.__zlbAttachmentRuntime ??= createRuntime();
  return globalRuntime.__zlbAttachmentRuntime;
}

export function requireTestStorageAdapter(): InMemoryStorageAdapter {
  if (process.env.APP_ENV !== "test") throw new Error("TEST_ATTACHMENT_STORAGE_DISABLED");
  const storage = getAttachmentRuntime().storage;
  if (!(storage instanceof InMemoryStorageAdapter)) throw new Error("TEST_ATTACHMENT_STORAGE_DISABLED");
  return storage;
}
