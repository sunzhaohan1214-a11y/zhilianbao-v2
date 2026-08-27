import type { JobTask } from "@/generated/prisma/client";
import { PermanentJobError } from "./errors";
import { isJobType, parseJobPayload, type JobPayloadByType, type JobType } from "./job-types";

export type JobHandlerContext = { workerId: string; job: JobTask };
export type JobHandler<T extends JobType = JobType> = {
  handle(payload: JobPayloadByType[T], context: JobHandlerContext): Promise<void>;
};

export class JobHandlerRegistry {
  private readonly handlers = new Map<JobType, JobHandler>();

  register<T extends JobType>(jobType: T, handler: JobHandler<T>): void {
    if (this.handlers.has(jobType)) throw new Error(`JOB_HANDLER_ALREADY_REGISTERED:${jobType}`);
    this.handlers.set(jobType, handler as JobHandler);
  }

  async dispatch(job: JobTask, workerId: string): Promise<void> {
    if (!isJobType(job.jobType)) throw new PermanentJobError("UNKNOWN_JOB_TYPE", "Unknown job type");
    const handler = this.handlers.get(job.jobType);
    if (!handler) throw new PermanentJobError("JOB_HANDLER_NOT_REGISTERED", "Job handler is not registered");
    let payload: JobPayloadByType[typeof job.jobType];
    try {
      payload = parseJobPayload(job.jobType, job.payloadJson);
    } catch (error) {
      throw new PermanentJobError("INVALID_JOB_PAYLOAD", "Job payload is invalid", { cause: error });
    }
    await handler.handle(payload, { workerId, job });
  }
}
