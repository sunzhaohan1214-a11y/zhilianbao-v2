import type { OutboxEvent, Prisma } from "@/generated/prisma/client";
import { PermanentOutboxError } from "./errors";
import {
  isOutboxEventType,
  outboxPayloadSchemas,
  type OutboxEventType,
  type OutboxPayloadByType,
} from "./outbox-types";

export type OutboxHandler<T extends OutboxEventType = OutboxEventType> = {
  handle(payload: OutboxPayloadByType[T], context: {
    event: OutboxEvent;
    tx: Prisma.TransactionClient;
  }): Promise<void>;
};

export class OutboxHandlerRegistry {
  private readonly handlers = new Map<OutboxEventType, OutboxHandler>();

  register<T extends OutboxEventType>(eventType: T, handler: OutboxHandler<T>): void {
    if (this.handlers.has(eventType)) throw new Error(`OUTBOX_HANDLER_ALREADY_REGISTERED:${eventType}`);
    this.handlers.set(eventType, handler as OutboxHandler);
  }

  async dispatch(event: OutboxEvent, tx: Prisma.TransactionClient): Promise<void> {
    if (!isOutboxEventType(event.eventType)) {
      throw new PermanentOutboxError("UNKNOWN_OUTBOX_EVENT_TYPE", "Unknown Outbox event type");
    }
    const handler = this.handlers.get(event.eventType);
    if (!handler) throw new PermanentOutboxError("OUTBOX_HANDLER_NOT_REGISTERED", "Outbox handler is not registered");
    const parsed = outboxPayloadSchemas[event.eventType].safeParse(event.payloadJson);
    if (!parsed.success) throw new PermanentOutboxError("INVALID_OUTBOX_PAYLOAD", "Outbox payload is invalid");
    await handler.handle(parsed.data, { event, tx });
  }
}
