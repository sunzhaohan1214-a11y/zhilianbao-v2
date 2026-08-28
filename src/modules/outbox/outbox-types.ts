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
  "DEMAND_CLAIMED",
  "DEMAND_RECOMMENDED_CURRENT",
  "DEMAND_RECOMMENDED_ALUMNI",
  "DEMAND_ALUMNI_RESPONSE_RECORDED",
  "DEMAND_ALUMNI_HELP_ACTIVATED",
  "DEMAND_PROGRESS_ADDED",
  "TEAM_COORDINATOR_STALE_REMINDER",
  "DEMAND_CLOSE_SUBMITTED",
  "DEMAND_CLOSE_RETURNED",
  "DEMAND_COMPLETED",
  "DEMAND_OWNER_EXIT_REQUESTED",
  "DEMAND_OWNER_EXIT_APPROVED",
  "DEMAND_OWNER_EXIT_REJECTED",
  "DEMAND_OWNER_TRANSFERRED",
  "DEMAND_CANCELED",
  "OUTCOME_TRACKING_DUE",
  "OUTCOME_SUBMITTED",
  "OUTCOME_RETURNED",
  "OUTCOME_APPROVED_CONTINUE",
  "OUTCOME_TRACKING_ENDED",
  "COLLABORATION_APPLIED",
  "COLLABORATION_INVITED",
  "COLLABORATION_APPROVED",
  "COLLABORATION_ACCEPTED",
  "COLLABORATOR_LEFT",
  "COLLABORATOR_REMOVED",
  "HELP_TRANSFERRED_ORG",
  "HELP_ASSIGNED_PERSON",
  "HELP_CLAIMED",
  "HELP_COMPLETED",
  "HELP_REOPENED",
  "HELP_REASSIGNED",
  "HELP_WITHDRAWN",
  "TRIP_PARTICIPANT_ADDED",
  "TRIP_UPDATED",
  "TRIP_RESULT_DUE_SCHEDULED",
  "TRIP_CANCELED",
  "TRIP_RESULT_SUBMITTED",
  "REIMBURSEMENT_SUBMITTED",
  "REIMBURSEMENT_RETURNED",
  "REIMBURSEMENT_VERIFIED",
  "REIMBURSEMENT_PAPER_RECEIVED",
  "REIMBURSEMENT_PAPER_INCOMPLETE",
  "REIMBURSEMENT_FINANCE_SUBMITTED",
  "REIMBURSEMENT_WITHDRAWN",
  "REIMBURSEMENT_STATE_CORRECTED",
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

function tripRecipientPayloadSchema() {
  return z.object({
    tripId: z.uuid(),
    recipientIds: recipientIdsSchema,
    eventKey: z.string().min(1).max(120),
  }).strict();
}

function reimbursementPayloadSchema() {
  return z.object({
    reimbursementId: z.uuid(),
    applicantPersonId: z.uuid(),
    managerRecipientIds: recipientIdsSchema,
    eventKey: z.string().min(1).max(120),
    toState: z.enum(["DRAFT", "PENDING_ONLINE_REVIEW", "RETURNED", "VERIFIED_PENDING_PAPER", "PAPER_RECEIVED", "FINANCE_SUBMITTED", "LEGACY_VERIFIED_TERMINAL"]).optional(),
  }).strict();
}

function recommendationPayloadSchema() {
  return z.object({
    aggregateId: z.uuid(),
    recipientIds: recipientIdsSchema,
    todoRecipientIds: recipientIdsSchema,
    staleTodoRecipientIds: recipientIdsSchema,
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
  DEMAND_CLAIMED: businessPayloadSchema(),
  DEMAND_RECOMMENDED_CURRENT: recommendationPayloadSchema(),
  DEMAND_RECOMMENDED_ALUMNI: recommendationPayloadSchema(),
  DEMAND_ALUMNI_RESPONSE_RECORDED: z.object({
    aggregateId: z.uuid(),
    respondentPersonId: z.uuid(),
    eventKey: z.string().min(1).max(120),
  }).strict(),
  DEMAND_ALUMNI_HELP_ACTIVATED: z.object({
    aggregateId: z.uuid(),
    handlerPersonId: z.uuid(),
    platformHelperPersonId: z.uuid().optional(),
    eventKey: z.string().min(1).max(120),
  }).strict(),
  DEMAND_PROGRESS_ADDED: businessPayloadSchema(),
  TEAM_COORDINATOR_STALE_REMINDER: businessPayloadSchema(),
  DEMAND_CLOSE_SUBMITTED: businessPayloadSchema(),
  DEMAND_CLOSE_RETURNED: businessPayloadSchema(),
  DEMAND_COMPLETED: businessPayloadSchema(),
  DEMAND_OWNER_EXIT_REQUESTED: businessPayloadSchema(),
  DEMAND_OWNER_EXIT_APPROVED: businessPayloadSchema(),
  DEMAND_OWNER_EXIT_REJECTED: businessPayloadSchema(),
  DEMAND_OWNER_TRANSFERRED: businessPayloadSchema(),
  DEMAND_CANCELED: businessPayloadSchema(),
  OUTCOME_TRACKING_DUE: businessPayloadSchema(),
  OUTCOME_SUBMITTED: businessPayloadSchema(),
  OUTCOME_RETURNED: businessPayloadSchema(),
  OUTCOME_APPROVED_CONTINUE: businessPayloadSchema(),
  OUTCOME_TRACKING_ENDED: businessPayloadSchema(),
  COLLABORATION_APPLIED: businessPayloadSchema(),
  COLLABORATION_INVITED: businessPayloadSchema(),
  COLLABORATION_APPROVED: businessPayloadSchema(),
  COLLABORATION_ACCEPTED: businessPayloadSchema(),
  COLLABORATOR_LEFT: businessPayloadSchema(),
  COLLABORATOR_REMOVED: businessPayloadSchema(),
  HELP_TRANSFERRED_ORG: businessPayloadSchema(),
  HELP_ASSIGNED_PERSON: businessPayloadSchema(),
  HELP_CLAIMED: businessPayloadSchema(),
  HELP_COMPLETED: businessPayloadSchema(),
  HELP_REOPENED: businessPayloadSchema(),
  HELP_REASSIGNED: businessPayloadSchema(),
  HELP_WITHDRAWN: businessPayloadSchema(),
  TRIP_PARTICIPANT_ADDED: tripRecipientPayloadSchema(),
  TRIP_UPDATED: tripRecipientPayloadSchema(),
  TRIP_RESULT_DUE_SCHEDULED: z.object({
    tripId: z.uuid(),
    dueAt: z.iso.datetime(),
    eventKey: z.string().min(1).max(120),
  }).strict(),
  TRIP_CANCELED: tripRecipientPayloadSchema(),
  TRIP_RESULT_SUBMITTED: tripRecipientPayloadSchema(),
  REIMBURSEMENT_SUBMITTED: reimbursementPayloadSchema(),
  REIMBURSEMENT_RETURNED: reimbursementPayloadSchema(),
  REIMBURSEMENT_VERIFIED: reimbursementPayloadSchema(),
  REIMBURSEMENT_PAPER_RECEIVED: reimbursementPayloadSchema(),
  REIMBURSEMENT_PAPER_INCOMPLETE: reimbursementPayloadSchema(),
  REIMBURSEMENT_FINANCE_SUBMITTED: reimbursementPayloadSchema(),
  REIMBURSEMENT_WITHDRAWN: reimbursementPayloadSchema(),
  REIMBURSEMENT_STATE_CORRECTED: reimbursementPayloadSchema(),
} satisfies Record<OutboxEventType, z.ZodType>;

export type OutboxPayloadByType = {
  [K in OutboxEventType]: z.infer<(typeof outboxPayloadSchemas)[K]>;
};

export function isOutboxEventType(value: string): value is OutboxEventType {
  return (OUTBOX_EVENT_TYPES as readonly string[]).includes(value);
}
