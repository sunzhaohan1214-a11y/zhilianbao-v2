import "dotenv/config";
import { writeLog } from "@/lib/logging/logger";
import { AttachmentScanJobRuntime } from "@/modules/jobs/attachment-scan-job-runtime";
import { loadWorkerConfig } from "@/modules/jobs/worker-config";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const config = loadWorkerConfig();
  const runtime = new AttachmentScanJobRuntime(config);
  let stopping = false;
  const stop = () => { stopping = true; };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  try {
    while (!stopping) {
      const cycle = await runtime.run();
      if (!cycle.claimed && !stopping) await wait(config.pollIntervalMs);
    }
  } finally {
    await runtime.disconnect();
  }
}

void main().catch((error: unknown) => {
  writeLog("error", {
    module: "attachment-scan-daemon",
    result: "fatal",
    errorCode: error instanceof Error ? error.name : "UNKNOWN_FATAL_ERROR",
  });
  process.exitCode = 1;
});
