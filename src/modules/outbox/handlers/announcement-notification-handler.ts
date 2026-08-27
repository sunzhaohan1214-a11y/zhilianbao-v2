import { createTodo, staleTodos, upsertMessage } from "@/modules/notification/notification-write-service";
import type { OutboxHandler } from "../outbox-handler-registry";

type EventType = "ANNOUNCEMENT_PUBLISHED" | "ANNOUNCEMENT_UPDATED" | "ANNOUNCEMENT_AUDIENCE_ADDED" | "ANNOUNCEMENT_AUDIENCE_REMOVED" | "ANNOUNCEMENT_WITHDRAWN";

export class AnnouncementNotificationHandler<T extends EventType> implements OutboxHandler<T> {
  constructor(private readonly eventType: T) {}

  async handle(payload: Parameters<OutboxHandler<T>["handle"]>[0], { tx, event }: Parameters<OutboxHandler<T>["handle"]>[1]) {
    const version = await tx.announcementVersion.findUnique({
      where: { id: payload.versionId },
      select: { title: true, needConfirm: true },
    });
    if (!version) return;

    if (this.eventType === "ANNOUNCEMENT_UPDATED") {
      await staleTodos(tx, {
        aggregateType: "ANNOUNCEMENT",
        aggregateId: payload.announcementId,
        todoType: "ANNOUNCEMENT_CONFIRM",
        excludeEventKey: payload.eventKey,
        now: event.occurredAt,
      });
    }
    if (this.eventType === "ANNOUNCEMENT_AUDIENCE_REMOVED" || this.eventType === "ANNOUNCEMENT_WITHDRAWN") {
      await staleTodos(tx, { aggregateType: "ANNOUNCEMENT", aggregateId: payload.announcementId, personIds: payload.recipientIds, todoType: "ANNOUNCEMENT_CONFIRM", now: event.occurredAt });
      return;
    }

    const messageType = this.eventType === "ANNOUNCEMENT_UPDATED" ? "ANNOUNCEMENT_UPDATED" : "ANNOUNCEMENT_PUBLISHED";
    for (const personId of payload.recipientIds) {
      await upsertMessage(tx, {
        personId,
        messageType,
        title: this.eventType === "ANNOUNCEMENT_UPDATED" ? "公告已更新" : "新公告",
        summary: version.title,
        aggregateType: "ANNOUNCEMENT",
        aggregateId: payload.announcementId,
        actionUrl: `/announcements/${payload.announcementId}`,
        dedupeKey: `${messageType}:${payload.announcementId}:${personId}`,
        eventAt: event.occurredAt,
      });
      if (payload.needConfirm) {
        const recipientState = await tx.announcementRecipientState.findUnique({
          where: { versionId_personId: { versionId: payload.versionId, personId } },
          select: { confirmedAt: true, revokedAt: true },
        });
        if (!recipientState || recipientState.revokedAt || recipientState.confirmedAt) continue;
        await createTodo(tx, {
          personId,
          todoType: "ANNOUNCEMENT_CONFIRM",
          module: "ANNOUNCEMENT",
          aggregateType: "ANNOUNCEMENT",
          aggregateId: payload.announcementId,
          actionUrl: `/announcements/${payload.announcementId}`,
          dedupeKey: `ANNOUNCEMENT_CONFIRM:${payload.versionId}:${personId}`,
          eventKey: payload.eventKey,
          reopenStale: this.eventType === "ANNOUNCEMENT_AUDIENCE_ADDED",
        });
      }
    }
  }
}
