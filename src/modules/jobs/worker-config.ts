import { z } from "zod";

const positiveInteger = z.coerce.number().int().positive();
const configSchema = z.object({
  WORKER_CONCURRENCY: positiveInteger.max(16).default(2),
  WORKER_POLL_INTERVAL_MS: positiveInteger.max(60_000).default(2_000),
  WORKER_JOB_LOCK_TIMEOUT_SECONDS: positiveInteger.max(86_400).default(900),
  WORKER_HEARTBEAT_SECONDS: positiveInteger.max(3_600).default(60),
  WORKER_GRACEFUL_SHUTDOWN_SECONDS: positiveInteger.max(600).default(30),
  WORKER_RUN_ONCE: z.enum(["true", "false"]).default("false"),
  OUTBOX_BATCH_SIZE: positiveInteger.max(500).default(20),
  OUTBOX_MAX_ATTEMPTS: positiveInteger.max(100).default(10),
});

export type WorkerConfig = {
  concurrency: number;
  pollIntervalMs: number;
  jobLockTimeoutMs: number;
  heartbeatMs: number;
  gracefulShutdownMs: number;
  runOnce: boolean;
  outboxBatchSize: number;
  outboxMaxAttempts: number;
};

export function loadWorkerConfig(environment: Record<string, string | undefined> = process.env): WorkerConfig {
  const parsed = configSchema.parse(environment);
  if (parsed.WORKER_HEARTBEAT_SECONDS * 2 >= parsed.WORKER_JOB_LOCK_TIMEOUT_SECONDS) {
    throw new Error("WORKER_HEARTBEAT_MUST_BE_WELL_BELOW_LOCK_TIMEOUT");
  }
  return {
    concurrency: parsed.WORKER_CONCURRENCY,
    pollIntervalMs: parsed.WORKER_POLL_INTERVAL_MS,
    jobLockTimeoutMs: parsed.WORKER_JOB_LOCK_TIMEOUT_SECONDS * 1_000,
    heartbeatMs: parsed.WORKER_HEARTBEAT_SECONDS * 1_000,
    gracefulShutdownMs: parsed.WORKER_GRACEFUL_SHUTDOWN_SECONDS * 1_000,
    runOnce: parsed.WORKER_RUN_ONCE === "true",
    outboxBatchSize: parsed.OUTBOX_BATCH_SIZE,
    outboxMaxAttempts: parsed.OUTBOX_MAX_ATTEMPTS,
  };
}
