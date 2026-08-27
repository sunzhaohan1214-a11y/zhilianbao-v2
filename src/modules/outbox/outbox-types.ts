import { z } from "zod";

export const OUTBOX_EVENT_TYPES = [
  "TEST_ENTITY_CHANGED",
  "ATTACHMENT_UPLOADED",
  "DEMAND_LEAD_CREATED",
  "DEMAND_LEAD_MORE_INFO_REQUESTED",
  "DEMAND_LEAD_INFO_ADDED",
  "DEMAND_LEAD_ENTERPRISE_LINKED",
  "DEMAND_LEAD_MERGED",
  "DEMAND_LEAD_CLOSED",
  "DEMAND_LEAD_RESTORED",
  "DEMAND_DRAFT_CREATED_FROM_LEAD",
] as const;
export type OutboxEventType = (typeof OUTBOX_EVENT_TYPES)[number];

export const outboxPayloadSchemas = {
  TEST_ENTITY_CHANGED: z.object({ entityId: z.uuid() }).strict(),
  ATTACHMENT_UPLOADED: z.object({ attachmentId: z.uuid() }).strict(),
  DEMAND_LEAD_CREATED: z.object({ leadId: z.uuid(), businessNo: z.string(), responsibleAreaId: z.uuid(), status: z.string() }).strict(),
  DEMAND_LEAD_MORE_INFO_REQUESTED: z.object({ leadId: z.uuid(), status: z.string(), responsibleAreaId: z.uuid() }).strict(),
  DEMAND_LEAD_INFO_ADDED: z.object({ leadId: z.uuid(), status: z.string(), responsibleAreaId: z.uuid() }).strict(),
  DEMAND_LEAD_ENTERPRISE_LINKED: z.object({ leadId: z.uuid(), enterpriseId: z.uuid(), status: z.string() }).strict(),
  DEMAND_LEAD_MERGED: z.object({ sourceLeadId: z.uuid(), targetLeadId: z.uuid(), responsibleAreaId: z.uuid() }).strict(),
  DEMAND_LEAD_CLOSED: z.object({ leadId: z.uuid(), responsibleAreaId: z.uuid() }).strict(),
  DEMAND_LEAD_RESTORED: z.object({ leadId: z.uuid(), status: z.string(), responsibleAreaId: z.uuid() }).strict(),
  DEMAND_DRAFT_CREATED_FROM_LEAD: z.object({ demandId: z.uuid(), demandLeadId: z.uuid(), businessNo: z.string(), responsibleAreaId: z.uuid() }).strict(),
} satisfies Record<OutboxEventType, z.ZodType>;

export type OutboxPayloadByType = {
  [K in OutboxEventType]: z.infer<(typeof outboxPayloadSchemas)[K]>;
};

export function isOutboxEventType(value: string): value is OutboxEventType {
  return (OUTBOX_EVENT_TYPES as readonly string[]).includes(value);
}
