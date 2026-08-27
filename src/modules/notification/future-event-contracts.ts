/**
 * Typed contracts reserved for A-M1-004. They are deliberately not
 * registered as runtime Outbox event types until those domain models land on
 * main, so the Worker can never accept an event without a real consumer.
 */
export type DemandCollaborationNotificationContract = {
  eventType: "DEMAND_COLLABORATION_APPLIED" | "DEMAND_COLLABORATION_INVITED" | "DEMAND_COLLABORATION_ACCEPTED";
  demandId: string;
  actorPersonId: string;
  recipientPersonIds: readonly string[];
  eventKey: string;
};
