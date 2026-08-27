import { z } from "zod";

export const OUTBOX_EVENT_TYPES = [
  "TEST_ENTITY_CHANGED",
  "ATTACHMENT_UPLOADED",
] as const;
export type OutboxEventType = (typeof OUTBOX_EVENT_TYPES)[number];

export const outboxPayloadSchemas = {
  TEST_ENTITY_CHANGED: z.object({ entityId: z.uuid() }).strict(),
  ATTACHMENT_UPLOADED: z.object({ attachmentId: z.uuid() }).strict(),
} satisfies Record<OutboxEventType, z.ZodType>;

export type OutboxPayloadByType = {
  [K in OutboxEventType]: z.infer<(typeof outboxPayloadSchemas)[K]>;
};

export function isOutboxEventType(value: string): value is OutboxEventType {
  return (OUTBOX_EVENT_TYPES as readonly string[]).includes(value);
}
