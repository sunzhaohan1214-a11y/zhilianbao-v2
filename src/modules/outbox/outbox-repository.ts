import type { OutboxEvent, Prisma, PrismaClient } from "@/generated/prisma/client";
import type { OutboxEventType, OutboxPayloadByType } from "./outbox-types";

function isUniqueConflict(error: unknown): boolean {
  return (error as { code?: string })?.code === "P2002";
}

export class OutboxRepository {
  constructor(private readonly prisma: PrismaClient | null = null) {}

  async append<T extends OutboxEventType>(input: {
    eventType: T;
    aggregateType: string;
    aggregateId: string;
    payload: OutboxPayloadByType[T];
    dedupeKey: string;
    occurredAt?: Date;
  }, client?: PrismaClient | Prisma.TransactionClient): Promise<OutboxEvent> {
    const database = client ?? this.prisma;
    if (!database) throw new Error("OUTBOX_DATABASE_CLIENT_REQUIRED");
    try {
      return await database.outboxEvent.create({ data: {
        eventType: input.eventType,
        aggregateType: input.aggregateType.slice(0, 100),
        aggregateId: input.aggregateId,
        payloadJson: input.payload as Prisma.InputJsonValue,
        dedupeKey: input.dedupeKey.slice(0, 191),
        occurredAt: input.occurredAt ?? new Date(),
      } });
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      return database.outboxEvent.findUniqueOrThrow({ where: { dedupeKey: input.dedupeKey.slice(0, 191) } });
    }
  }
}
