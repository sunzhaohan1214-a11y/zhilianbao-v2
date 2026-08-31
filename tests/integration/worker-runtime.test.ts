import { describe, expect, it, vi } from "vitest";
import type { JobRepository } from "@/modules/jobs/job-repository";
import type { JobRunner } from "@/modules/jobs/job-runner";
import { WorkerRuntime } from "@/modules/jobs/worker-runtime";
import type { OutboxConsumer } from "@/modules/outbox/outbox-consumer";
import { AttachmentScanJobRuntime } from "@/modules/jobs/attachment-scan-job-runtime";
import type { AttachmentRecoveryService } from "@/modules/attachment/attachment-recovery-service";

describe("M0-006 bounded Worker runtime", () => {
  it("runs recovery, Outbox and a bounded job batch in run-once mode", async () => {
    const job = {
      id: "job-1",
      jobType: "ATTACHMENT_TEMP_CLEANUP",
      payloadJson: {},
      status: "RUNNING",
      priority: 0,
      idempotencyKey: "cleanup",
      scheduledAt: new Date(),
      lockedAt: new Date(),
      lockedBy: "test-worker",
      retryCount: 0,
      maxRetries: 3,
      finishedAt: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as const;
    const enqueue = vi.fn().mockResolvedValue(job);
    const recoverStale = vi.fn().mockResolvedValue(1);
    const claimNextByTypes = vi.fn().mockResolvedValueOnce(job).mockResolvedValue(null);
    const run = vi.fn().mockResolvedValue(undefined);
    const consumeBatch = vi.fn().mockResolvedValue(2);
    const runtime = new WorkerRuntime({
      concurrency: 2,
      pollIntervalMs: 1,
      jobLockTimeoutMs: 10_000,
      heartbeatMs: 1_000,
      gracefulShutdownMs: 100,
      runOnce: true,
      outboxBatchSize: 20,
      outboxMaxAttempts: 3,
    }, () => undefined, {
      workerId: "test-worker",
      jobs: { enqueue, recoverStale, claimNextByTypes } as unknown as JobRepository,
      runner: { run } as unknown as JobRunner,
      outbox: { consumeBatch } as unknown as OutboxConsumer,
    });

    await expect(runtime.run()).resolves.toEqual({ graceful: true });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(recoverStale).toHaveBeenCalledWith(expect.objectContaining({
      jobTypes: expect.not.arrayContaining(["ATTACHMENT_SCAN"]),
    }));
    expect(claimNextByTypes).toHaveBeenCalledWith("test-worker", expect.not.arrayContaining(["ATTACHMENT_SCAN"]));
    expect(consumeBatch).toHaveBeenCalledWith(20);
    expect(run).toHaveBeenCalledWith(job, "test-worker");
  });

  it("stops claiming and drains an active job during graceful shutdown", async () => {
    const job = {
      id: "job-graceful",
      jobType: "ATTACHMENT_TEMP_CLEANUP",
      payloadJson: {},
      status: "RUNNING",
      priority: 0,
      idempotencyKey: "cleanup-graceful",
      scheduledAt: new Date(),
      lockedAt: new Date(),
      lockedBy: "graceful-worker",
      retryCount: 0,
      maxRetries: 3,
      finishedAt: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as const;
    let finish!: () => void;
    const active = new Promise<void>((resolve) => { finish = resolve; });
    const run = vi.fn().mockReturnValue(active);
    const claimNextByTypes = vi.fn().mockResolvedValueOnce(job).mockResolvedValue(null);
    const runtime = new WorkerRuntime({
      concurrency: 1,
      pollIntervalMs: 1,
      jobLockTimeoutMs: 10_000,
      heartbeatMs: 1_000,
      gracefulShutdownMs: 1_000,
      runOnce: false,
      outboxBatchSize: 1,
      outboxMaxAttempts: 3,
    }, () => undefined, {
      workerId: "graceful-worker",
      jobs: {
        enqueue: vi.fn().mockResolvedValue(job),
        recoverStale: vi.fn().mockResolvedValue(0),
        claimNextByTypes,
      } as unknown as JobRepository,
      runner: { run } as unknown as JobRunner,
      outbox: { consumeBatch: vi.fn().mockResolvedValue(0) } as unknown as OutboxConsumer,
    });

    const running = runtime.run();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    runtime.requestStop();
    finish();
    await expect(running).resolves.toEqual({ graceful: true });
    expect(claimNextByTypes).toHaveBeenCalledTimes(1);
  });
});

describe("on-demand attachment scan Job runtime", () => {
  it("recovers and claims only one ATTACHMENT_SCAN job before exiting", async () => {
    const now = new Date("2026-08-29T00:00:00.000Z");
    const job = {
      id: "scan-job",
      jobType: "ATTACHMENT_SCAN",
      payloadJson: { attachmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      status: "RUNNING",
      priority: 0,
      idempotencyKey: "attachment-scan:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      scheduledAt: now,
      lockedAt: now,
      lockedBy: "scan-worker",
      retryCount: 0,
      maxRetries: 3,
      finishedAt: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    } as const;
    const recoverStale = vi.fn().mockResolvedValue(1);
    const claimNextByTypes = vi.fn().mockResolvedValue(job);
    const run = vi.fn().mockResolvedValue(undefined);
    const runtime = new AttachmentScanJobRuntime({ jobLockTimeoutMs: 10_000, heartbeatMs: 1_000 }, () => undefined, {
      workerId: "scan-worker",
      jobs: { recoverStale, claimNextByTypes } as unknown as JobRepository,
      runner: { run } as unknown as JobRunner,
      recovery: { recoverStaleScan: vi.fn() } as unknown as AttachmentRecoveryService,
    });

    await expect(runtime.run(now)).resolves.toEqual({ claimed: true, recovered: 1 });
    expect(recoverStale).toHaveBeenCalledWith(expect.objectContaining({ jobTypes: ["ATTACHMENT_SCAN"] }));
    expect(claimNextByTypes).toHaveBeenCalledWith("scan-worker", ["ATTACHMENT_SCAN"], now);
    expect(run).toHaveBeenCalledWith(job, "scan-worker");
  });
});
