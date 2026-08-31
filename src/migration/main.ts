import path from "node:path";
import { disconnectPrismaClient, getPrismaClient } from "@/lib/db/prisma";
import { resolveCapabilities } from "@/modules/permissions/role-capabilities";
import type { PermissionActor } from "@/modules/permissions/types";
import { assertMigrationEnvironmentAllowed, loadMigrationResolutions, MigrationService, SnapshotDirectoryLegacySourceProvider, runMigrationPreview, writeMigrationReports } from "@/modules/migration";

type Options = { source?: string; mode?: "sample" | "full"; dryRun: boolean; apply: boolean; confirm?: string; operator?: string; output?: string; resolutions?: string };

function parseArgs(argv: string[]): Options {
  const result: Options = { dryRun: false, apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--dry-run") result.dryRun = true;
    else if (value === "--apply") result.apply = true;
    else if (["--source", "--mode", "--confirm", "--operator", "--output", "--resolutions"].includes(value)) {
      const next = argv[index + 1]; if (!next) throw new Error(`MIGRATION_ARGUMENT_MISSING:${value}`); index += 1;
      if (value === "--source") result.source = next;
      if (value === "--mode") { if (next !== "sample" && next !== "full") throw new Error("MIGRATION_MODE_INVALID"); result.mode = next; }
      if (value === "--confirm") result.confirm = next;
      if (value === "--operator") result.operator = next;
      if (value === "--output") result.output = next;
      if (value === "--resolutions") result.resolutions = next;
    } else throw new Error(`MIGRATION_ARGUMENT_UNKNOWN:${value}`);
  }
  if (!result.source || !result.mode || result.dryRun === result.apply) throw new Error("MIGRATION_ARGUMENTS_INVALID");
  if (result.apply && (result.confirm !== "MIGRATE_TO_V2" || !result.operator)) throw new Error("MIGRATION_APPLY_CONFIRMATION_REQUIRED");
  return result;
}

async function loadOperator(personId: string): Promise<PermissionActor> {
  const prisma = getPrismaClient();
  const now = new Date();
  const person = await prisma.person.findUnique({ where: { id: personId }, include: { account: true, roleAssignments: { where: { effectiveAt: { lte: now }, OR: [{ expiredAt: null }, { expiredAt: { gt: now } }] } } } });
  if (!person?.account || person.account.status !== "NORMAL" || person.account.forcePasswordChange || !person.roleAssignments.some(({ roleCode }) => roleCode === "SUPER_ADMIN")) throw new Error("MIGRATION_OPERATOR_NOT_ACTIVE_SUPER_ADMIN");
  const roles = ["SUPER_ADMIN"] as const;
  const specialPermissions = new Set(["reimbursement.manage", "ai.service_manage"]);
  return { personId, accountId: person.account.id, accountStatus: person.account.status, permissionVersion: person.account.permissionVersion, effectiveRoles: [...roles], capabilities: resolveCapabilities(roles, specialPermissions), specialPermissions,
    selfPersonId: personId, townshipAreaIds: [], departmentAreaIds: [], hasGlobalPublished: true, hasGlobalOperational: true, hasSystem: true, currentBatchMember: false, configurationIssues: [] };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  assertMigrationEnvironmentAllowed(process.env.APP_ENV, options.apply ? "APPLY" : "DRY_RUN");
  const provider = new SnapshotDirectoryLegacySourceProvider(path.resolve(options.source!));
  const mode = options.mode === "sample" ? "SAMPLE_REHEARSAL" : "FULL_REHEARSAL";
  const preview = await runMigrationPreview(provider, { mode, fullSnapshotAvailable: options.mode === "full" });
  let batchId = `dry-run-${preview.manifest.snapshotId}`;
  let reconciliation = preview.reconciliation;
  let issues = preview.issues;
  let actionCounts: Record<string, number> | undefined;
  if (options.apply) {
    const actor = await loadOperator(options.operator!);
    const resolutions = await loadMigrationResolutions(path.resolve(options.source!), options.resolutions);
    const applied = await new MigrationService().applySnapshot({ actor, provider, manifest: preview.manifest, manifestSha256: preview.manifestSha256, codeVersion: process.env.GITHUB_SHA ?? process.env.npm_package_version ?? "local", mode, resolutions });
    batchId = applied.batchId;
    reconciliation = applied.reconciliation;
    issues = applied.issues;
    actionCounts = applied.actionCounts;
  }
  const outputDirectory = path.resolve(options.output ?? path.join(".migration-output", batchId));
  const reportPaths = await writeMigrationReports(outputDirectory, reconciliation, issues);
  console.info(JSON.stringify({ batchId, mode, dryRun: options.dryRun, phase: options.apply ? "ACTUAL_APPLY" : "PLANNED_PREVIEW", actionCounts, moduleCounts: reconciliation.modules.map(({ module, sourceCount, successCount, failedCount, mergedCount, reviewCount }) => ({ module, sourceCount, successCount, failedCount, mergedCount, reviewCount })),
    issueCounts: { total: issues.length, blocker: issues.filter(({ severity }) => severity === "BLOCKER").length, review: issues.filter(({ severity }) => severity === "REVIEW").length }, reportPaths }));
}

main()
  .catch((error) => { console.error(JSON.stringify({ errorCode: error && typeof error === "object" && "code" in error ? String(error.code) : error instanceof Error ? error.message.split(":")[0] : "MIGRATION_FAILED" })); process.exitCode = 1; })
  .finally(disconnectPrismaClient);
