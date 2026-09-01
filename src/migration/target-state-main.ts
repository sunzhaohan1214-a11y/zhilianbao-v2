import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { disconnectPrismaClient, getPrismaClient } from "@/lib/db/prisma";
import { collectMigrationBatchWriteAttestation } from "@/modules/migration/batch-write-attestation";
import { normalizeMigrationEnvironment } from "@/modules/migration/environment-guard";
import { collectMigrationTargetStateEvidence } from "@/modules/migration/target-state-evidence";

type Options = { batchId?: string; candidateSha?: string; manifestSha256?: string; output?: string };

function parseArgs(argv: string[]): Options {
  const result: Options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!["--batch", "--candidate-sha", "--manifest-sha", "--output"].includes(value)) throw new Error(`MIGRATION_TARGET_STATE_ARGUMENT_UNKNOWN:${value}`);
    const next = argv[index + 1];
    if (!next) throw new Error(`MIGRATION_TARGET_STATE_ARGUMENT_MISSING:${value}`);
    index += 1;
    if (value === "--batch") result.batchId = next;
    if (value === "--candidate-sha") result.candidateSha = next;
    if (value === "--manifest-sha") result.manifestSha256 = next;
    if (value === "--output") result.output = next;
  }
  return result;
}

async function main() {
  if (normalizeMigrationEnvironment(process.env.APP_ENV) !== "TEST") throw new Error("MIGRATION_TARGET_STATE_TEST_ONLY");
  const options = parseArgs(process.argv.slice(2));
  const batchId = options.batchId?.trim();
  const candidateSha = options.candidateSha?.trim() || process.env.APP_VERSION?.trim() || process.env.GITHUB_SHA?.trim();
  const manifestSha256 = options.manifestSha256?.trim();
  const targetEnvironment = process.env.V1_MIGRATION_APPROVED_TARGET_ENVIRONMENT?.trim();
  const targetMigrationDatabase = process.env.V1_MIGRATION_APPROVED_TARGET_DATABASE?.trim();
  if (!batchId || !candidateSha || !manifestSha256 || !targetEnvironment || !targetMigrationDatabase) {
    throw new Error("MIGRATION_TARGET_STATE_ARGUMENTS_REQUIRED");
  }

  const prisma = getPrismaClient();
  const [targetState, writeAttestation] = await Promise.all([
    collectMigrationTargetStateEvidence({
      prisma,
      batchId,
      candidateSha,
      manifestSha256,
      targetEnvironment,
      targetMigrationDatabase,
    }),
    collectMigrationBatchWriteAttestation({ prisma, batchId }),
  ]);
  const evidence = { ...targetState, ...writeAttestation };
  const outputPath = path.resolve(options.output ?? path.join(".migration-output", batchId, "target-state.json"));
  await mkdir(path.dirname(outputPath), { recursive: true });
  const content = `${JSON.stringify(evidence, null, 2)}\n`;
  await writeFile(outputPath, content, { flag: "wx" });
  const digest = createHash("sha256").update(content).digest("hex");
  const pointer = { reference: `urn:sha256:${digest}`, sourcePath: outputPath };
  await writeFile(`${outputPath}.pointer.json`, `${JSON.stringify(pointer, null, 2)}\n`, { flag: "wx" });
  console.info(JSON.stringify({
    status: "TARGET_STATE_EVIDENCE_COLLECTED",
    batchId,
    reference: pointer.reference,
    outputFile: path.basename(outputPath),
    pointerFile: path.basename(`${outputPath}.pointer.json`),
  }));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ errorCode: error instanceof Error ? error.message.split(":")[0] : "MIGRATION_TARGET_STATE_FAILED" }));
    process.exitCode = 1;
  })
  .finally(disconnectPrismaClient);