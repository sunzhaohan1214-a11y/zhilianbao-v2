import type { OutboxEvent, Prisma, PrismaClient } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import type { OutboxEventType, OutboxPayloadByType } from "./outbox-types";

function isUniqueConflict(error: unknown): boolean {
  return (error as { code?: string })?.code === "P2002";
}

export class OutboxRepository {
  constructor(private readonly prisma: PrismaClient = getPrismaClient()) {}

  async append<T extends OutboxEventType>(input: {
    eventType: T;
    aggregateType: string;
    aggregateId: string;
    payload: OutboxPayloadByType[T];
    dedupeKey: string;
    occurredAt?: Date;
  }, client: PrismaClient | Prisma.TransactionClient = this.prisma): Promise<OutboxEvent> {
    try {
      return await client.outboxEvent.create({ data: {
        eventType: input.eventType,
        aggregateType: input.aggregateType.slice(0, 100),
        aggregateId: input.aggregateId,
        payloadJson: input.payload as Prisma.InputJsonValue,
        dedupeKey: input.dedupeKey.slice(0, 191),
        occurredAt: input.occurredAt ?? new Date(),
      } });
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      return client.outboxEvent.findUniqueOrThrow({ where: { dedupeKey: input.dedupeKey.slice(0, 191) } });
    }
  }
}
