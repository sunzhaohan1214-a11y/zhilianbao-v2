import "dotenv/config";
import { writeLog } from "@/lib/logging/logger";
import { AttachmentScanJobRuntime } from "@/modules/jobs/attachment-scan-job-runtime";
import { loadWorkerConfig } from "@/modules/jobs/worker-config";

async function main(): Promise<void> {
  if (process.argv.includes("--help")) {
    console.log("Usage: npm run start:attachment-scan-job (claims at most one ATTACHMENT_SCAN JobTask and exits)");
    return;
  }
  const runtime = new AttachmentScanJobRuntime(loadWorkerConfig());
  try {
    await runtime.run();
  } finally {
    await runtime.disconnect();
  }
}

void main().catch((error: unknown) => {
  writeLog("error", {
    module: "attachment-scan-job",
    result: "fatal",
    errorCode: error instanceof Error ? error.name : "UNKNOWN_FATAL_ERROR",
  });
  process.exitCode = 1;
});
