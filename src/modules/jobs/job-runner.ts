import type { JobTask } from "@/generated/prisma/client";
import { safeJobError } from "./errors";
import type { JobHandlerRegistry } from "./handler-registry";
import type { JobRepository } from "./job-repository";

export type WorkerLogger = (entry: Record<string, unknown>) => void;

export class JobRunner {
  constructor(
    private readonly repository: JobRepository,
    private readonly handlers: JobHandlerRegistry,
    private readonly heartbeatMs: number,
    private readonly logger: WorkerLogger,
  ) {}

  async run(job: JobTask, workerId: string): Promise<void> {
    const startedAt = Date.now();
    const queueWaitMs = Math.max(0, startedAt - job.createdAt.getTime());
    let heartbeatBusy = false;
    const heartbeat = setInterval(async () => {
      if (heartbeatBusy) return;
      heartbeatBusy = true;
      try {
        const renewed = await this.repository.renewLease(job.id, workerId);
        if (!renewed) this.logger({ worker_id: workerId, job_id: job.id, job_type: job.jobType, attempt: job.retryCount + 1, queue_wait_ms: queueWaitMs, run_duration_ms: Date.now() - startedAt, result: "lease_lost", error_code: "JOB_LEASE_LOST" });
      } catch {
        this.logger({ worker_id: workerId, job_id: job.id, job_type: job.jobType, attempt: job.retryCount + 1, queue_wait_ms: queueWaitMs, run_duration_ms: Date.now() - startedAt, result: "heartbeat_error", error_code: "JOB_HEARTBEAT_ERROR" });
      } finally {
        heartbeatBusy = false;
      }
    }, this.heartbeatMs);
    heartbeat.unref();

    try {
      await this.handlers.dispatch(job, workerId);
      const completed = await this.repository.completeOwned(job.id, workerId);
      this.logger({
        worker_id: workerId,
        job_id: job.id,
        job_type: job.jobType,
        attempt: job.retryCount + 1,
        queue_wait_ms: queueWaitMs,
        run_duration_ms: Date.now() - startedAt,
        result: completed ? "succeeded" : "lease_lost",
        ...(completed ? {} : { error_code: "JOB_LEASE_LOST" }),
      });
    } catch (error) {
      const safe = safeJobError(error);
      const failed = await this.repository.failOwned({
        jobId: job.id,
        workerId,
        errorSummary: safe.summary,
        retryable: safe.retryable,
      });
      this.logger({
        worker_id: workerId,
        job_id: job.id,
        job_type: job.jobType,
        attempt: job.retryCount + 1,
        queue_wait_ms: queueWaitMs,
        run_duration_ms: Date.now() - startedAt,
        result: failed?.status === "WAITING" ? "retry_scheduled" : failed?.status === "FAILED" ? "failed" : "lease_lost",
        error_code: safe.code,
      });
    } finally {
      clearInterval(heartbeat);
    }
  }
}
