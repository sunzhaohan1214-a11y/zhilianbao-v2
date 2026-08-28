import { z } from "zod";

export const JOB_TYPES = ["ATTACHMENT_SCAN", "ATTACHMENT_TEMP_CLEANUP", "DEMAND_RECOMMENDATION_RUN", "TRIP_RESULT_DUE"] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const jobPayloadSchemas = {
  ATTACHMENT_SCAN: z.object({ attachmentId: z.uuid() }).strict(),
  ATTACHMENT_TEMP_CLEANUP: z.object({ limit: z.number().int().min(1).max(500).optional() }).strict(),
  DEMAND_RECOMMENDATION_RUN: z.object({ runId: z.uuid() }).strict(),
  TRIP_RESULT_DUE: z.object({
    tripId: z.uuid(),
    dueAt: z.iso.datetime(),
    eventKey: z.string().min(1).max(120),
  }).strict(),
} satisfies Record<JobType, z.ZodType>;

export type JobPayloadByType = {
  [K in JobType]: z.infer<(typeof jobPayloadSchemas)[K]>;
};

export function parseJobPayload<T extends JobType>(jobType: T, payload: unknown): JobPayloadByType[T] {
  return jobPayloadSchemas[jobType].parse(payload) as JobPayloadByType[T];
}

export function isJobType(value: string): value is JobType {
  return (JOB_TYPES as readonly string[]).includes(value);
}
