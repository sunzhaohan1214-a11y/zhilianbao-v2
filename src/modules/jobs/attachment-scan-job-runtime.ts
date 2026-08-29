import { getPrismaClient } from "@/lib/db/prisma";
import { AttachmentRecoveryService } from "@/modules/attachment/attachment-recovery-service";
import { getAttachmentRuntime } from "@/modules/attachment/runtime";
import { AttachmentScanJobHandler } from "./handlers/attachment-scan-handler";
import { JobHandlerRegistry } from "./handler-registry";
import { JobRepository } from "./job-repository";
import { JobRunner, type WorkerLogger } from "./job-runner";
import { jobPayloadSchemas } from "./job-types";
import { createWorkerId, jsonWorkerLogger } from "./worker-identity";
import type { WorkerConfig } from "./worker-config";

export class AttachmentScanJobRuntime {
  private readonly workerId: string;
  private readonly jobs: JobRepository;
  private readonly runner: JobRunner;
  private readonly recovery: AttachmentRecoveryService;

  constructor(
    private readonly config: Pick<WorkerConfig, "jobLockTimeoutMs" | "heartbeatMs">,
    private readonly logger: WorkerLogger = jsonWorkerLogger,
    dependencies?: {
      workerId?: string;
      jobs?: JobRepository;
      runner?: JobRunner;
      recovery?: AttachmentRecoveryService;
    },
  ) {
    this.workerId = dependencies?.workerId ?? `attachment-scan:${createWorkerId()}`.slice(0, 100);
    this.jobs = dependencies?.jobs ?? new JobRepository();
    this.recovery = dependencies?.recovery ?? new AttachmentRecoveryService();
    if (dependencies?.runner) {
      this.runner = dependencies.runner;
      return;
    }
    const handlers = new JobHandlerRegistry();
    handlers.register("ATTACHMENT_SCAN", new AttachmentScanJobHandler(getAttachmentRuntime().scanService));
    this.runner = new JobRunner(this.jobs, handlers, config.heartbeatMs, logger);
  }

  async run(now = new Date()): Promise<{ claimed: boolean; recovered: number }> {
    const recovered = await this.jobs.recoverStale({
      staleBefore: new Date(now.getTime() - this.config.jobLockTimeoutMs),
      now,
      jobTypes: ["ATTACHMENT_SCAN"],
      onRecover: async (tx, job) => {
        const payload = jobPayloadSchemas.ATTACHMENT_SCAN.safeParse(job.payloadJson);
        if (payload.success) await this.recovery.recoverStaleScan(tx, payload.data.attachmentId);
      },
    });
    const job = await this.jobs.claimNextByTypes(this.workerId, ["ATTACHMENT_SCAN"], now);
    if (!job) {
      this.logger({ worker_id: this.workerId, job_type: "ATTACHMENT_SCAN", result: "idle", recovered });
      return { claimed: false, recovered };
    }
    await this.runner.run(job, this.workerId);
    return { claimed: true, recovered };
  }

  async disconnect(): Promise<void> {
    await getPrismaClient().$disconnect();
  }
}
