import "dotenv/config";
import { WorkerRuntime } from "@/modules/jobs/worker-runtime";
import { loadWorkerConfig } from "@/modules/jobs/worker-config";

async function main(): Promise<void> {
  if (process.argv.includes("--help")) {
    console.log("Usage: npm run start:worker (set WORKER_RUN_ONCE=true for a bounded cycle)");
    return;
  }
  const runtime = new WorkerRuntime(loadWorkerConfig());
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    runtime.requestStop();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  try {
    await runtime.run();
  } finally {
    await runtime.disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    module: "worker",
    result: "fatal",
    error_code: error instanceof Error ? error.name : "UNKNOWN_FATAL_ERROR",
  }));
  process.exitCode = 1;
});
