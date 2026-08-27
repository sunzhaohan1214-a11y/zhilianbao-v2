import type { JobStatus, JobTask, Prisma, PrismaClient } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { retryDelayMs, type RetryPolicyOptions } from "./retry-policy";
import type { JobPayloadByType, JobType } from "./job-types";

export type JobTransaction = Prisma.TransactionClient;
type StaleRecoveryHook = (tx: JobTransaction, job: JobTask) => Promise<void>;

function isUniqueConflict(error: unknown): boolean {
  return (error as { code?: string })?.code === "P2002";
}

export class JobRepository {
  constructor(private readonly prisma: PrismaClient = getPrismaClient()) {}

  async enqueue<T extends JobType>(input: {
    jobType: T;
    payload: JobPayloadByType[T];
    idempotencyKey: string;
    scheduledAt?: Date;
    maxRetries?: number;
    priority?: number;
  }, client: PrismaClient | JobTransaction = this.prisma): Promise<JobTask> {
    try {
      return await client.jobTask.create({ data: {
        jobType: input.jobType,
        payloadJson: input.payload as Prisma.InputJsonValue,
        idempotencyKey: input.idempotencyKey,
        scheduledAt: input.scheduledAt ?? new Date(),
        maxRetries: input.maxRetries ?? 3,
        priority: input.priority ?? 0,
      } });
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      return client.jobTask.findUniqueOrThrow({ where: { idempotencyKey: input.idempotencyKey } });
    }
  }

  claimNext(workerId: string, now = new Date()): Promise<JobTask | null> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM job_tasks
        WHERE status = 'WAITING' AND scheduled_at <= ${now}
        ORDER BY priority DESC, scheduled_at ASC, created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;
      if (rows.length === 0) return null;
      const changed = await tx.jobTask.updateMany({
        where: { id: rows[0].id, status: "WAITING" },
        data: { status: "RUNNING", lockedAt: now, lockedBy: workerId, finishedAt: null },
      });
      if (changed.count !== 1) return null;
      return tx.jobTask.findUniqueOrThrow({ where: { id: rows[0].id } });
    });
  }

  async renewLease(jobId: string, workerId: string, now = new Date()): Promise<boolean> {
    const result = await this.prisma.jobTask.updateMany({
      where: { id: jobId, status: "RUNNING", lockedBy: workerId },
      data: { lockedAt: now },
    });
    return result.count === 1;
  }

  async completeOwned(jobId: string, workerId: string, now = new Date()): Promise<boolean> {
    const result = await this.prisma.jobTask.updateMany({
      where: { id: jobId, status: "RUNNING", lockedBy: workerId },
      data: { status: "SUCCEEDED", finishedAt: now, lockedAt: null, lockedBy: null, lastError: null },
    });
    return result.count === 1;
  }

  failOwned(input: {
    jobId: string;
    workerId: string;
    errorSummary: string;
    retryable: boolean;
    now?: Date;
    retryPolicy?: RetryPolicyOptions;
  }): Promise<JobTask | null> {
    const now = input.now ?? new Date();
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM job_tasks
        WHERE id = ${input.jobId} AND status = 'RUNNING' AND locked_by = ${input.workerId}
        FOR UPDATE
      `;
      if (rows.length !== 1) return null;
      const job = await tx.jobTask.findUniqueOrThrow({ where: { id: input.jobId } });
      const nextRetryCount = input.retryable ? job.retryCount + 1 : job.retryCount;
      const retry = input.retryable && nextRetryCount < job.maxRetries;
      await tx.jobTask.update({ where: { id: job.id }, data: retry ? {
        status: "WAITING",
        retryCount: nextRetryCount,
        scheduledAt: new Date(now.getTime() + retryDelayMs(nextRetryCount, input.retryPolicy)),
        lockedAt: null,
        lockedBy: null,
        lastError: input.errorSummary.slice(0, 500),
      } : {
        status: "FAILED",
        retryCount: nextRetryCount,
        finishedAt: now,
        lockedAt: null,
        lockedBy: null,
        lastError: input.errorSummary.slice(0, 500),
      } });
      return tx.jobTask.findUniqueOrThrow({ where: { id: job.id } });
    });
  }

  recoverStale(input: {
    staleBefore: Date;
    now?: Date;
    limit?: number;
    retryPolicy?: RetryPolicyOptions;
    onRecover?: StaleRecoveryHook;
  }): Promise<number> {
    const now = input.now ?? new Date();
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM job_tasks
        WHERE status = 'RUNNING' AND locked_at < ${input.staleBefore}
        ORDER BY locked_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `;
      for (const row of rows) {
        const job = await tx.jobTask.findUniqueOrThrow({ where: { id: row.id } });
        await input.onRecover?.(tx, job);
        const nextRetryCount = job.retryCount + 1;
        const retry = nextRetryCount < job.maxRetries;
        await tx.jobTask.update({ where: { id: job.id }, data: retry ? {
          status: "WAITING",
          retryCount: nextRetryCount,
          scheduledAt: new Date(now.getTime() + retryDelayMs(nextRetryCount, input.retryPolicy)),
          lockedAt: null,
          lockedBy: null,
          lastError: "STALE_WORKER_LEASE_EXPIRED",
        } : {
          status: "FAILED",
          retryCount: nextRetryCount,
          finishedAt: now,
          lockedAt: null,
          lockedBy: null,
          lastError: "STALE_WORKER_LEASE_EXPIRED",
        } });
      }
      return rows.length;
    });
  }

  async cancelWaiting(jobId: string, now = new Date()): Promise<boolean> {
    const result = await this.prisma.jobTask.updateMany({
      where: { id: jobId, status: "WAITING" },
      data: { status: "CANCELED", finishedAt: now },
    });
    return result.count === 1;
  }

  countByStatus(status: JobStatus): Promise<number> {
    return this.prisma.jobTask.count({ where: { status } });
  }
}
