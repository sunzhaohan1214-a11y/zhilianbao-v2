import type { PrismaClient } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { retryDelayMs, type RetryPolicyOptions } from "@/modules/jobs/retry-policy";
import { safeOutboxError } from "./errors";
import type { OutboxHandlerRegistry } from "./outbox-handler-registry";

export type OutboxLogger = (entry: Record<string, unknown>) => void;

export class OutboxConsumer {
  constructor(
    private readonly handlers: OutboxHandlerRegistry,
    private readonly maximumAttempts: number,
    private readonly logger: OutboxLogger,
    private readonly prisma: PrismaClient = getPrismaClient(),
    private readonly retryPolicy?: RetryPolicyOptions,
  ) {}

  consumeOne(now = new Date()): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM outbox_events
        WHERE published_at IS NULL
          AND failed_at IS NULL
          AND (next_attempt_at IS NULL OR next_attempt_at <= ${now})
        ORDER BY occurred_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;
      if (rows.length === 0) return false;
      const event = await tx.outboxEvent.findUniqueOrThrow({ where: { id: rows[0].id } });
      try {
        await this.handlers.dispatch(event, tx);
        await tx.outboxEvent.update({ where: { id: event.id }, data: {
          publishedAt: now,
          nextAttemptAt: null,
          lastError: null,
        } });
        this.logger({ outbox_id: event.id, event_type: event.eventType, attempt: event.attempts + 1, result: "published" });
      } catch (error) {
        const attempts = event.attempts + 1;
        const terminal = attempts >= this.maximumAttempts;
        const errorCode = safeOutboxError(error);
        await tx.outboxEvent.update({ where: { id: event.id }, data: terminal ? {
          attempts,
          failedAt: now,
          nextAttemptAt: null,
          lastError: errorCode,
        } : {
          attempts,
          nextAttemptAt: new Date(now.getTime() + retryDelayMs(attempts, this.retryPolicy)),
          lastError: errorCode,
        } });
        this.logger({
          outbox_id: event.id,
          event_type: event.eventType,
          attempt: attempts,
          result: terminal ? "failed" : "retry_scheduled",
          error_code: errorCode,
        });
      }
      return true;
    });
  }

  async consumeBatch(limit: number, now = new Date()): Promise<number> {
    let consumed = 0;
    while (consumed < limit && await this.consumeOne(now)) consumed += 1;
    return consumed;
  }
}
