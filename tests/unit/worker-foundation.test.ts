import { describe, expect, it } from "vitest";
import { PermanentJobError } from "@/modules/jobs/errors";
import { JobHandlerRegistry } from "@/modules/jobs/handler-registry";
import { parseJobPayload } from "@/modules/jobs/job-types";
import { retryDelayMs } from "@/modules/jobs/retry-policy";
import { loadWorkerConfig } from "@/modules/jobs/worker-config";

describe("M0-006 worker foundation", () => {
  it("validates payloads by declared job type", () => {
    expect(parseJobPayload("ATTACHMENT_SCAN", { attachmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }))
      .toEqual({ attachmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    expect(() => parseJobPayload("ATTACHMENT_SCAN", { attachmentId: "not-a-uuid" })).toThrow();
    expect(() => parseJobPayload("ATTACHMENT_TEMP_CLEANUP", { limit: 501 })).toThrow();
    expect(parseJobPayload("TRIP_RESULT_DUE", {
      tripId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      dueAt: "2026-08-30T15:59:59.999Z",
      eventKey: "2026-08-30T15:59:59.999Z",
    })).toMatchObject({ tripId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
  });

  it("uses deterministic capped exponential backoff", () => {
    const options = { random: () => 0 };
    expect(retryDelayMs(1, options)).toBe(5_000);
    expect(retryDelayMs(2, options)).toBe(15_000);
    expect(retryDelayMs(3, options)).toBe(45_000);
    expect(retryDelayMs(99, options)).toBe(15 * 60_000);
  });

  it("loads safe worker defaults and rejects an unsafe heartbeat ratio", () => {
    expect(loadWorkerConfig({})).toMatchObject({
      concurrency: 2,
      pollIntervalMs: 2_000,
      jobLockTimeoutMs: 900_000,
      heartbeatMs: 60_000,
      runOnce: false,
      outboxBatchSize: 20,
      outboxMaxAttempts: 10,
    });
    expect(() => loadWorkerConfig({
      WORKER_JOB_LOCK_TIMEOUT_SECONDS: "60",
      WORKER_HEARTBEAT_SECONDS: "30",
    })).toThrow("WORKER_HEARTBEAT_MUST_BE_WELL_BELOW_LOCK_TIMEOUT");
  });

  it("fails permanently before dispatching an invalid payload", async () => {
    const registry = new JobHandlerRegistry();
    let called = false;
    registry.register("ATTACHMENT_SCAN", { async handle() { called = true; } });
    await expect(registry.dispatch({
      id: "job",
      jobType: "ATTACHMENT_SCAN",
      payloadJson: { attachmentId: "invalid" },
      status: "RUNNING",
      priority: 0,
      idempotencyKey: "job",
      scheduledAt: new Date(),
      lockedAt: new Date(),
      lockedBy: "worker",
      retryCount: 0,
      maxRetries: 3,
      finishedAt: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }, "worker")).rejects.toBeInstanceOf(PermanentJobError);
    expect(called).toBe(false);
  });
});
