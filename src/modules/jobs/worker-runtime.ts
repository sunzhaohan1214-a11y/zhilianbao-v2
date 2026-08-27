import { hostname } from "node:os";
import { randomBytes } from "node:crypto";
import { getPrismaClient } from "@/lib/db/prisma";
import { AttachmentRecoveryService } from "@/modules/attachment/attachment-recovery-service";
import { getAttachmentRuntime } from "@/modules/attachment/runtime";
import { AttachmentUploadedOutboxHandler } from "@/modules/outbox/handlers/attachment-uploaded-handler";
import { AnnouncementNotificationHandler } from "@/modules/outbox/handlers/announcement-notification-handler";
import { BusinessNotificationHandler } from "@/modules/outbox/handlers/business-notification-handler";
import { DemandParticipationNotificationHandler } from "@/modules/outbox/handlers/demand-participation-notification-handler";
import { TripLifecycleHandler, TripParticipantAddedHandler, TripResultDueScheduledHandler } from "@/modules/outbox/handlers/trip-notification-handler";
import { OutboxConsumer } from "@/modules/outbox/outbox-consumer";
import { OutboxHandlerRegistry } from "@/modules/outbox/outbox-handler-registry";
import { AttachmentCleanupJobHandler } from "./handlers/attachment-cleanup-handler";
import { AttachmentScanJobHandler } from "./handlers/attachment-scan-handler";
import { TripResultDueJobHandler } from "./handlers/trip-result-due-handler";
import { JobHandlerRegistry } from "./handler-registry";
import { JobRepository } from "./job-repository";
import { JobRunner, type WorkerLogger } from "./job-runner";
import { jobPayloadSchemas } from "./job-types";
import type { WorkerConfig } from "./worker-config";

export function createWorkerId(): string {
  return `${hostname().slice(0, 40)}:${process.pid}:${randomBytes(4).toString("hex")}`.slice(0, 100);
}

export const jsonWorkerLogger: WorkerLogger = (entry) => {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), module: "worker", ...entry }));
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class WorkerRuntime {
  private stopping = false;
  private readonly active = new Set<Promise<void>>();
  private readonly workerId: string;
  private readonly jobs: JobRepository;
  private readonly runner: JobRunner;
  private readonly outbox: OutboxConsumer;
  private readonly attachmentRecovery = new AttachmentRecoveryService();

  constructor(
    private readonly config: WorkerConfig,
    private readonly logger: WorkerLogger = jsonWorkerLogger,
    dependencies?: {
      workerId?: string;
      jobs?: JobRepository;
      runner?: JobRunner;
      outbox?: OutboxConsumer;
    },
  ) {
    this.workerId = dependencies?.workerId ?? createWorkerId();
    this.jobs = dependencies?.jobs ?? new JobRepository();
    if (dependencies?.runner && dependencies?.outbox) {
      this.runner = dependencies.runner;
      this.outbox = dependencies.outbox;
      return;
    }

    const attachment = getAttachmentRuntime();
    const jobHandlers = new JobHandlerRegistry();
    jobHandlers.register("ATTACHMENT_SCAN", new AttachmentScanJobHandler(attachment.scanService));
    jobHandlers.register("ATTACHMENT_TEMP_CLEANUP", new AttachmentCleanupJobHandler(attachment.cleanupService));
    jobHandlers.register("TRIP_RESULT_DUE", new TripResultDueJobHandler());
    this.runner = dependencies?.runner ?? new JobRunner(this.jobs, jobHandlers, config.heartbeatMs, logger);

    const outboxHandlers = new OutboxHandlerRegistry();
    outboxHandlers.register("ATTACHMENT_UPLOADED", new AttachmentUploadedOutboxHandler(this.jobs));
    for (const eventType of ["ANNOUNCEMENT_PUBLISHED", "ANNOUNCEMENT_UPDATED", "ANNOUNCEMENT_AUDIENCE_ADDED", "ANNOUNCEMENT_AUDIENCE_REMOVED", "ANNOUNCEMENT_WITHDRAWN"] as const) {
      outboxHandlers.register(eventType, new AnnouncementNotificationHandler(eventType));
    }
    for (const eventType of ["DEMAND_SUBMITTED_REVIEW", "DEMAND_REVIEW_RETURNED", "DEMAND_PUBLISHED", "HELP_TRANSFERRED_ORG", "HELP_ASSIGNED_PERSON", "HELP_CLAIMED", "HELP_COMPLETED", "HELP_REOPENED", "HELP_REASSIGNED", "HELP_WITHDRAWN"] as const) {
      outboxHandlers.register(eventType, new BusinessNotificationHandler(eventType));
    }
    for (const eventType of ["DEMAND_CLAIMED", "COLLABORATION_APPLIED", "COLLABORATION_INVITED", "COLLABORATION_APPROVED", "COLLABORATION_ACCEPTED", "COLLABORATOR_LEFT", "COLLABORATOR_REMOVED"] as const) {
      outboxHandlers.register(eventType, new DemandParticipationNotificationHandler(eventType));
    }
    outboxHandlers.register("TRIP_PARTICIPANT_ADDED", new TripParticipantAddedHandler());
    outboxHandlers.register("TRIP_UPDATED", new TripLifecycleHandler("TRIP_UPDATED"));
    outboxHandlers.register("TRIP_RESULT_DUE_SCHEDULED", new TripResultDueScheduledHandler(this.jobs));
    outboxHandlers.register("TRIP_CANCELED", new TripLifecycleHandler("TRIP_CANCELED"));
    outboxHandlers.register("TRIP_RESULT_SUBMITTED", new TripLifecycleHandler("TRIP_RESULT_SUBMITTED"));
    this.outbox = dependencies?.outbox ?? new OutboxConsumer(outboxHandlers, config.outboxMaxAttempts, logger);
  }

  requestStop(): void {
    this.stopping = true;
  }

  private async recoverStale(now = new Date()): Promise<number> {
    return this.jobs.recoverStale({
      staleBefore: new Date(now.getTime() - this.config.jobLockTimeoutMs),
      now,
      onRecover: async (tx, job) => {
        if (job.jobType !== "ATTACHMENT_SCAN") return;
        const parsed = jobPayloadSchemas.ATTACHMENT_SCAN.safeParse(job.payloadJson);
        if (!parsed.success) return; // The runner permanently fails invalid payloads after recovery.
        await this.attachmentRecovery.recoverStaleScan(tx, parsed.data.attachmentId);
      },
    });
  }

  private async ensureCleanupJob(now = new Date()): Promise<void> {
    const hour = now.toISOString().slice(0, 13);
    await this.jobs.enqueue({
      jobType: "ATTACHMENT_TEMP_CLEANUP",
      payload: { limit: 100 },
      idempotencyKey: `attachment-temp-cleanup:${hour}`,
      maxRetries: 5,
      priority: -10,
    });
  }

  private start(job: Awaited<ReturnType<JobRepository["claimNext"]>>): void {
    if (!job) return;
    const task = this.runner.run(job, this.workerId).finally(() => this.active.delete(task));
    this.active.add(task);
  }

  private async fillCapacity(): Promise<number> {
    let claimed = 0;
    while (!this.stopping && this.active.size < this.config.concurrency) {
      const job = await this.jobs.claimNext(this.workerId);
      if (!job) break;
      this.start(job);
      claimed += 1;
    }
    return claimed;
  }

  private async runCycle(): Promise<{ recovered: number; outbox: number; claimed: number }> {
    const recovered = await this.recoverStale();
    const outbox = await this.outbox.consumeBatch(this.config.outboxBatchSize);
    const claimed = await this.fillCapacity();
    return { recovered, outbox, claimed };
  }

  async run(): Promise<{ graceful: boolean }> {
    await this.ensureCleanupJob();
    this.logger({ worker_id: this.workerId, result: "ready" });
    if (this.config.runOnce) {
      await this.runCycle();
      await Promise.allSettled(this.active);
      return { graceful: true };
    }

    while (!this.stopping) {
      const cycle = await this.runCycle();
      if (!this.stopping && cycle.claimed === 0 && cycle.outbox === 0 && cycle.recovered === 0) {
        await wait(this.config.pollIntervalMs);
      }
    }

    const drained = Promise.allSettled([...this.active]).then(() => true);
    const timedOut = wait(this.config.gracefulShutdownMs).then(() => false);
    const graceful = await Promise.race([drained, timedOut]);
    this.logger({ worker_id: this.workerId, result: graceful ? "stopped" : "shutdown_timeout" });
    return { graceful };
  }

  async disconnect(): Promise<void> {
    await getPrismaClient().$disconnect();
  }
}
