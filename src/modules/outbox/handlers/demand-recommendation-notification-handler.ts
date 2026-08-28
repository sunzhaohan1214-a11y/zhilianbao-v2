import { completeTodos, createTodo, staleTodos, upsertMessage } from "@/modules/notification/notification-write-service";
import type { OutboxHandler } from "../outbox-handler-registry";

type RecommendationEvent = "DEMAND_RECOMMENDED_CURRENT" | "DEMAND_RECOMMENDED_ALUMNI";

export class DemandRecommendationNotificationHandler<T extends RecommendationEvent> implements OutboxHandler<T> {
  constructor(private readonly eventType: T) {}

  async handle(payload: Parameters<OutboxHandler<T>["handle"]>[0], { tx, event }: Parameters<OutboxHandler<T>["handle"]>[1]) {
    if (this.eventType === "DEMAND_RECOMMENDED_ALUMNI") {
      await staleTodos(tx, {
        aggregateType: "DEMAND",
        aggregateId: payload.aggregateId,
        personIds: payload.staleTodoRecipientIds,
        todoType: "DEMAND_ALUMNI_RESPONSE",
        now: event.occurredAt,
      });
    }
    for (const personId of payload.recipientIds) {
      await upsertMessage(tx, {
        personId,
        messageType: this.eventType,
        title: "你收到一条需求推荐",
        summary: "有一条企业需求与你的能力资料相关，可进入详情查看",
        aggregateType: "DEMAND",
        aggregateId: payload.aggregateId,
        actionUrl: `/demands/${payload.aggregateId}`,
        dedupeKey: `${this.eventType}:${payload.aggregateId}:${personId}`,
        eventAt: event.occurredAt,
      });
    }
    if (this.eventType !== "DEMAND_RECOMMENDED_ALUMNI") return;
    for (const personId of payload.todoRecipientIds) {
      await createTodo(tx, {
        personId,
        todoType: "DEMAND_ALUMNI_RESPONSE",
        module: "DEMAND",
        aggregateType: "DEMAND",
        aggregateId: payload.aggregateId,
        actionUrl: `/demands/${payload.aggregateId}`,
        dedupeKey: `DEMAND_ALUMNI_RESPONSE:${payload.aggregateId}:${personId}`,
        eventKey: payload.eventKey,
        reopenStale: true,
      });
    }
  }
}

export class DemandAlumniResponseNotificationHandler implements OutboxHandler<"DEMAND_ALUMNI_RESPONSE_RECORDED"> {
  async handle(payload: Parameters<OutboxHandler<"DEMAND_ALUMNI_RESPONSE_RECORDED">["handle"]>[0], { tx, event }: Parameters<OutboxHandler<"DEMAND_ALUMNI_RESPONSE_RECORDED">["handle"]>[1]) {
    await completeTodos(tx, {
      aggregateType: "DEMAND",
      aggregateId: payload.aggregateId,
      personIds: [payload.respondentPersonId],
      todoType: "DEMAND_ALUMNI_RESPONSE",
      now: event.occurredAt,
    });
  }
}

export class DemandAlumniHelpActivatedNotificationHandler implements OutboxHandler<"DEMAND_ALUMNI_HELP_ACTIVATED"> {
  async handle(payload: Parameters<OutboxHandler<"DEMAND_ALUMNI_HELP_ACTIVATED">["handle"]>[0], { tx, event }: Parameters<OutboxHandler<"DEMAND_ALUMNI_HELP_ACTIVATED">["handle"]>[1]) {
    await upsertMessage(tx, {
      personId: payload.handlerPersonId,
      messageType: "DEMAND_ALUMNI_HELP_ACTIVATED",
      title: "往届协助路径已激活",
      summary: "该需求已进入往届协助路径，你是当前属地经办人",
      aggregateType: "DEMAND",
      aggregateId: payload.aggregateId,
      actionUrl: `/demands/${payload.aggregateId}`,
      dedupeKey: `DEMAND_ALUMNI_HELP_ACTIVATED:${payload.aggregateId}:${payload.handlerPersonId}`,
      eventAt: event.occurredAt,
    });
    if (!payload.platformHelperPersonId) return;
    await upsertMessage(tx, {
      personId: payload.platformHelperPersonId,
      messageType: "DEMAND_ALUMNI_HELP_ACTIVATED",
      title: "往届协助已登记",
      summary: "你已被登记为该需求的往届协助人",
      aggregateType: "DEMAND",
      aggregateId: payload.aggregateId,
      actionUrl: `/demands/${payload.aggregateId}`,
      dedupeKey: `DEMAND_ALUMNI_HELP_ACTIVATED:${payload.aggregateId}:${payload.platformHelperPersonId}`,
      eventAt: event.occurredAt,
    });
  }
}
