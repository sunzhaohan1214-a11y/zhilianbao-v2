import { loadAttachmentConfig } from "./attachment-config";
import { AttachmentError } from "./attachment-errors";
import { AttachmentCleanupService } from "./attachment-cleanup-service";
import { AttachmentLinkService } from "./attachment-link-service";
import { AttachmentScanService } from "./attachment-scan-service";
import { AttachmentService } from "./attachment-service";
import { AttachmentParentAuthorizerRegistry } from "./parent-authorization";
import { AttachmentRepository } from "./repository/attachment-repository";
import { ClamAvFileScanAdapter, UnavailableFileScanAdapter, type FileScanAdapter } from "./scan/file-scan-adapter";
import { InMemoryStorageAdapter } from "./storage/in-memory-storage-adapter";
import type { StorageAdapter } from "./storage/storage-adapter";
import { registerPolicyAttachmentAuthorizer } from "@/modules/policy/attachment-authorizer";
import { registerDemandAttachmentAuthorizers } from "@/modules/demand/attachment-authorization";
import { registerTripAttachmentAuthorizers } from "@/modules/trip/attachment-authorization";
import { registerTalentAttachmentAuthorizers } from "@/modules/talent/attachment-authorizer";
import { registerHelpAttachmentAuthorizers } from "@/modules/help/attachment-authorizer";
import { registerReimbursementAttachmentAuthorizers } from "@/modules/reimbursement/attachment-authorizer";
import { registerAnnouncementAttachmentAuthorizer } from "@/modules/announcement/attachment-authorizer";
import { registerImportAttachmentAuthorizer } from "@/modules/import-export/attachment-authorizer";
import { registerMonthlyReportAttachmentAuthorizer } from "@/modules/reporting/attachment-authorizer";
import { testOnlyProviderRuntimeAllowed } from "@/runtime/zero-extra-cost-policy";

type AttachmentRuntime = {
  storage: StorageAdapter;
  scanner: FileScanAdapter;
  repository: AttachmentRepository;
  service: AttachmentService;
  scanService: AttachmentScanService;
  linkService: AttachmentLinkService;
  cleanupService: AttachmentCleanupService;
  parentAuthorizers: AttachmentParentAuthorizerRegistry;
};

const globalRuntime = globalThis as typeof globalThis & { __zlbAttachmentRuntime?: AttachmentRuntime };

function createRuntime(): AttachmentRuntime {
  const { config, storage } = createAttachmentStorageRuntime();
  const repository = new AttachmentRepository();
  const parentAuthorizers = new AttachmentParentAuthorizerRegistry();
  registerPolicyAttachmentAuthorizer(parentAuthorizers);
  registerDemandAttachmentAuthorizers(parentAuthorizers);
  registerTripAttachmentAuthorizers(parentAuthorizers);
  registerTalentAttachmentAuthorizers(parentAuthorizers);
  registerHelpAttachmentAuthorizers(parentAuthorizers);
  registerReimbursementAttachmentAuthorizers(parentAuthorizers);
  registerAnnouncementAttachmentAuthorizer(parentAuthorizers);
  registerImportAttachmentAuthorizer(parentAuthorizers);
  registerMonthlyReportAttachmentAuthorizer(parentAuthorizers);
  const scanner = createFileScanAdapter();
  return {
    storage,
    scanner,
    repository,
    parentAuthorizers,
    service: new AttachmentService(repository, storage, parentAuthorizers, config),
    scanService: new AttachmentScanService(repository, storage, scanner),
    linkService: new AttachmentLinkService(repository),
    cleanupService: new AttachmentCleanupService(repository, storage),
  };
}

export function testMemoryAttachmentStorageEnabled(environment: Record<string, string | undefined> = process.env): boolean {
  return environment.ATTACHMENT_STORAGE_PROVIDER?.trim().toLowerCase() === "memory"
    && environment.ENABLE_TEST_MEMORY_ATTACHMENT_STORAGE === "true"
    && testOnlyProviderRuntimeAllowed(environment);
}

export function createAttachmentStorageRuntime(environment: Record<string, string | undefined> = process.env): {
  config: ReturnType<typeof loadAttachmentConfig>;
  storage: StorageAdapter;
} {
  const config = loadAttachmentConfig(environment);
  const provider = environment.ATTACHMENT_STORAGE_PROVIDER?.trim().toLowerCase();
  if (provider === "memory" && testMemoryAttachmentStorageEnabled(environment)) {
    return { config, storage: new InMemoryStorageAdapter(config) };
  }
  throw new AttachmentError("ATTACHMENT_STORAGE_UNAVAILABLE", "额外付费对象存储已禁用；仅本地测试内存存储或后续 CloudBase 套餐内存储可用");
}

export function createFileScanAdapter(environment: Record<string, string | undefined> = process.env): FileScanAdapter {
  if (environment.FILE_SCAN_PROVIDER?.trim().toLowerCase() !== "clamav") return new UnavailableFileScanAdapter();
  const host = environment.CLAMAV_HOST?.trim() ?? "";
  const port = Number(environment.CLAMAV_PORT ?? "3310");
  const timeoutMs = Number(environment.CLAMAV_TIMEOUT_MS ?? "10000");
  try { return new ClamAvFileScanAdapter({ host, port, timeoutMs }); }
  catch { return new UnavailableFileScanAdapter(); }
}

export function getAttachmentRuntime(): AttachmentRuntime {
  globalRuntime.__zlbAttachmentRuntime ??= createRuntime();
  return globalRuntime.__zlbAttachmentRuntime;
}

export function requireTestStorageAdapter(): InMemoryStorageAdapter {
  if (!testMemoryAttachmentStorageEnabled()) throw new Error("TEST_ATTACHMENT_STORAGE_DISABLED");
  const storage = getAttachmentRuntime().storage;
  if (!(storage instanceof InMemoryStorageAdapter)) throw new Error("TEST_ATTACHMENT_STORAGE_DISABLED");
  return storage;
}
