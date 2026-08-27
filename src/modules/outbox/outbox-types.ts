import { z } from "zod";

export const OUTBOX_EVENT_TYPES = [
  "TEST_ENTITY_CHANGED",
  "ATTACHMENT_UPLOADED",
  "ANNOUNCEMENT_PUBLISHED",
  "ANNOUNCEMENT_UPDATED",
  "ANNOUNCEMENT_AUDIENCE_ADDED",
  "ANNOUNCEMENT_AUDIENCE_REMOVED",
  "ANNOUNCEMENT_WITHDRAWN",
  "DEMAND_SUBMITTED_REVIEW",
  "DEMAND_REVIEW_RETURNED",
  "DEMAND_PUBLISHED",
  "HELP_TRANSFERRED_ORG",
  "HELP_ASSIGNED_PERSON",
  "HELP_CLAIMED",
  "HELP_COMPLETED",
  "HELP_REOPENED",
  "HELP_REASSIGNED",
  "HELP_WITHDRAWN",
] as const;
export type OutboxEventType = (typeof OUTBOX_EVENT_TYPES)[number];

const recipientIdsSchema = z.array(z.uuid()).max(5000).transform((ids) => [...new Set(ids)]);

function announcementPayloadSchema() {
  return z.object({
    announcementId: z.uuid(),
    versionId: z.uuid(),
    recipientIds: recipientIdsSchema,
    needConfirm: z.boolean(),
    eventKey: z.string().min(1).max(120),
  }).strict();
}

function businessPayloadSchema() {
  return z.object({
    aggregateId: z.uuid(),
    recipientIds: recipientIdsSchema,
    todoRecipientIds: recipientIdsSchema,
    staleTodoRecipientIds: recipientIdsSchema.optional(),
    eventKey: z.string().min(1).max(120),
  }).strict();
}

export const outboxPayloadSchemas = {
  TEST_ENTITY_CHANGED: z.object({ entityId: z.uuid() }).strict(),
  ATTACHMENT_UPLOADED: z.object({ attachmentId: z.uuid() }).strict(),
  ANNOUNCEMENT_PUBLISHED: announcementPayloadSchema(),
  ANNOUNCEMENT_UPDATED: announcementPayloadSchema(),
  ANNOUNCEMENT_AUDIENCE_ADDED: announcementPayloadSchema(),
  ANNOUNCEMENT_AUDIENCE_REMOVED: announcementPayloadSchema(),
  ANNOUNCEMENT_WITHDRAWN: announcementPayloadSchema(),
  DEMAND_SUBMITTED_REVIEW: businessPayloadSchema(),
  DEMAND_REVIEW_RETURNED: businessPayloadSchema(),
  DEMAND_PUBLISHED: businessPayloadSchema(),
  HELP_TRANSFERRED_ORG: businessPayloadSchema(),
  HELP_ASSIGNED_PERSON: businessPayloadSchema(),
  HELP_CLAIMED: businessPayloadSchema(),
  HELP_COMPLETED: businessPayloadSchema(),
  HELP_REOPENED: businessPayloadSchema(),
  HELP_REASSIGNED: businessPayloadSchema(),
  HELP_WITHDRAWN: businessPayloadSchema(),
} satisfies Record<OutboxEventType, z.ZodType>;

export type OutboxPayloadByType = {
  [K in OutboxEventType]: z.infer<(typeof outboxPayloadSchemas)[K]>;
};

export function isOutboxEventType(value: string): value is OutboxEventType {
  return (OUTBOX_EVENT_TYPES as readonly string[]).includes(value);
}
