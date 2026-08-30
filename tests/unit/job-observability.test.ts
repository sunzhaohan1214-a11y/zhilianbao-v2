import { describe, expect, it, vi } from "vitest";
import type { JobTask } from "@/generated/prisma/client";
import { JobRunner } from "@/modules/jobs/job-runner";
import type { JobRepository } from "@/modules/jobs/job-repository";
import type { JobHandlerRegistry } from "@/modules/jobs/handler-registry";

describe("JobRunner observability", () => {
  it("logs queue wait and run duration without payload", async () => {
    const logs: Record<string, unknown>[] = [];
    const repository = { completeOwned: vi.fn().mockResolvedValue(true), renewLease: vi.fn() } as unknown as JobRepository;
    const handlers = { dispatch: vi.fn().mockResolvedValue(undefined) } as unknown as JobHandlerRegistry;
    const job = { id: "job-1", jobType: "ATTACHMENT_SCAN", retryCount: 0, createdAt: new Date(Date.now() - 500), payloadJson: { secret: "must-not-log" } } as unknown as JobTask;
    await new JobRunner(repository, handlers, 60_000, (entry) => logs.push(entry)).run(job, "worker-1");
    expect(logs.at(-1)).toMatchObject({ job_id: "job-1", attempt: 1, result: "succeeded", queue_wait_ms: expect.any(Number), run_duration_ms: expect.any(Number) });
    expect(JSON.stringify(logs)).not.toContain("must-not-log");
  });
});
