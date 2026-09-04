const DISABLED_PAID_CONFIGURATION = [
  "CYNOSDB_CLUSTER_ID",
  "CYNOSDB_REGION",
  "TENCENTCLOUD_SECRET_ID",
  "TENCENTCLOUD_SECRET_KEY",
  "COS_SECRET_ID",
  "COS_SECRET_KEY",
  "COS_BUCKET",
  "COS_REGION",
  "ZLB_RUNTIME_SECRET_ID",
  "ZLB_RUNTIME_SECRET_REGION",
  "INVOICE_OCR_ENDPOINT",
  "INVOICE_OCR_API_KEY",
  "NEXT_PUBLIC_TENCENT_MAP_KEY",
] as const;

function isConfigured(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

/**
 * Reject legacy paid-cloud configuration before the application starts.
 * Values are never included in errors or logs.
 */
export function assertZeroExtraCostPolicy(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): void {
  const configuredKey = DISABLED_PAID_CONFIGURATION.find((key) => isConfigured(environment[key]));
  if (configuredKey) throw new Error(`EXTRA_PAID_PROVIDER_DISABLED:${configuredKey}`);

  const backupProvider = environment.BACKUP_PROVIDER?.trim().toLowerCase();
  if (backupProvider && backupProvider !== "unavailable" && backupProvider !== "fake") {
    throw new Error("EXTRA_PAID_PROVIDER_DISABLED:BACKUP_PROVIDER");
  }

  const attachmentProvider = environment.ATTACHMENT_STORAGE_PROVIDER?.trim().toLowerCase();
  if (attachmentProvider && attachmentProvider !== "memory") {
    throw new Error("EXTRA_PAID_PROVIDER_DISABLED:ATTACHMENT_STORAGE_PROVIDER");
  }
}
