import type { JobRepository } from "@/modules/jobs/job-repository";
import { staleTodos, upsertMessage } from "@/modules/notification/notification-write-service";
import type { OutboxHandler } from "../outbox-handler-registry";

export class TripParticipantAddedHandler implements OutboxHandler<"TRIP_PARTICIPANT_ADDED"> {
  async handle(payload: Parameters<OutboxHandler<"TRIP_PARTICIPANT_ADDED">["handle"]>[0], { tx, event }: Parameters<OutboxHandler<"TRIP_PARTICIPANT_ADDED">["handle"]>[1]) {
    for (const personId of payload.recipientIds) {
      await upsertMessage(tx, {
        personId,
        messageType: "TRIP_PARTICIPANT_ADDED",
        title: "已加入行程",
        summary: "你已被加入一项行程",
        aggregateType: "TRIP",
        aggregateId: payload.tripId,
        actionUrl: `/trips/${payload.tripId}`,
        dedupeKey: `TRIP_PARTICIPANT_ADDED:${payload.tripId}:${personId}:${payload.eventKey}`,
        eventAt: event.occurredAt,
      });
    }
  }
}

export class TripResultDueScheduledHandler implements OutboxHandler<"TRIP_RESULT_DUE_SCHEDULED"> {
  constructor(private readonly jobs: JobRepository) {}

  async handle(payload: Parameters<OutboxHandler<"TRIP_RESULT_DUE_SCHEDULED">["handle"]>[0], { tx }: Parameters<OutboxHandler<"TRIP_RESULT_DUE_SCHEDULED">["handle"]>[1]) {
    const dueAt = new Date(payload.dueAt);
    await this.jobs.enqueue({
      jobType: "TRIP_RESULT_DUE",
      payload,
      idempotencyKey: `trip-result-due:${payload.tripId}:${payload.dueAt}`,
      scheduledAt: new Date(dueAt.getTime() + 1),
      maxRetries: 5,
    }, tx);
  }
}

type LifecycleEvent = "TRIP_UPDATED" | "TRIP_CANCELED" | "TRIP_RESULT_SUBMITTED";

const lifecycleMessage: Record<LifecycleEvent, { title: string; summary: string }> = {
  TRIP_UPDATED: { title: "行程已更新", summary: "你参与的一项行程已有更新" },
  TRIP_CANCELED: { title: "行程已取消", summary: "你参与的一项行程已取消" },
  TRIP_RESULT_SUBMITTED: { title: "行程结果已提交", summary: "你参与的一项行程已提交结果" },
};

export class TripLifecycleHandler<T extends LifecycleEvent> implements OutboxHandler<T> {
  constructor(private readonly eventType: T) {}

  async handle(payload: Parameters<OutboxHandler<T>["handle"]>[0], { tx, event }: Parameters<OutboxHandler<T>["handle"]>[1]) {
    const message = lifecycleMessage[this.eventType];
    for (const personId of payload.recipientIds) {
      await upsertMessage(tx, {
        personId,
        messageType: this.eventType,
        title: message.title,
        summary: message.summary,
        aggregateType: "TRIP",
        aggregateId: payload.tripId,
        actionUrl: `/trips/${payload.tripId}`,
        dedupeKey: `${this.eventType}:${payload.tripId}:${personId}`,
        eventAt: event.occurredAt,
      });
    }
    if (this.eventType !== "TRIP_UPDATED") {
      await staleTodos(tx, {
        aggregateType: "TRIP",
        aggregateId: payload.tripId,
        todoType: "TRIP_RESULT",
        now: event.occurredAt,
      });
    }
  }
}
