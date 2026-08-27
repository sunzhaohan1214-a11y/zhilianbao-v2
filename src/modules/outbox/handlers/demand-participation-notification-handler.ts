import { createTodo, staleTodos, upsertMessage } from "@/modules/notification/notification-write-service";
import type { OutboxHandler } from "../outbox-handler-registry";

type EventType =
  | "DEMAND_CLAIMED"
  | "COLLABORATION_APPLIED"
  | "COLLABORATION_INVITED"
  | "COLLABORATION_APPROVED"
  | "COLLABORATION_ACCEPTED"
  | "COLLABORATOR_LEFT"
  | "COLLABORATOR_REMOVED";

const config: Record<EventType, {
  title: string;
  summary: string;
  todoType?: "COLLABORATION_REVIEW" | "COLLABORATION_INVITE_RESPONSE";
  staleTodoType?: "COLLABORATION_REVIEW" | "COLLABORATION_INVITE_RESPONSE";
}> = {
  DEMAND_CLAIMED: { title: "需求已被认领", summary: "负责区域内的一条正式需求已被认领" },
  COLLABORATION_APPLIED: { title: "协同申请待处理", summary: "有人申请协同处理你的需求", todoType: "COLLABORATION_REVIEW" },
  COLLABORATION_INVITED: { title: "协同邀请待回应", summary: "你收到一条需求协同邀请", todoType: "COLLABORATION_INVITE_RESPONSE" },
  COLLABORATION_APPROVED: { title: "协同申请已通过", summary: "你的需求协同申请已获批准", staleTodoType: "COLLABORATION_REVIEW" },
  COLLABORATION_ACCEPTED: { title: "协同邀请已接受", summary: "受邀人已接受你的需求协同邀请", staleTodoType: "COLLABORATION_INVITE_RESPONSE" },
  COLLABORATOR_LEFT: { title: "协同人已退出", summary: "一名协同人已退出需求协同" },
  COLLABORATOR_REMOVED: { title: "你已被移出协同", summary: "你已被负责人移出需求协同" },
};

export class DemandParticipationNotificationHandler<T extends EventType> implements OutboxHandler<T> {
  constructor(private readonly eventType: T) {}

  async handle(payload: Parameters<OutboxHandler<T>["handle"]>[0], { tx, event }: Parameters<OutboxHandler<T>["handle"]>[1]) {
    const current = config[this.eventType];
    if (current.staleTodoType && payload.staleTodoRecipientIds) {
      await staleTodos(tx, {
        aggregateType: "DEMAND",
        aggregateId: payload.aggregateId,
        personIds: payload.staleTodoRecipientIds,
        todoType: current.staleTodoType,
        eventKey: payload.eventKey,
        now: event.occurredAt,
      });
    }
    for (const personId of payload.recipientIds) {
      await upsertMessage(tx, {
        personId,
        messageType: this.eventType,
        title: current.title,
        summary: current.summary,
        aggregateType: "DEMAND",
        aggregateId: payload.aggregateId,
        actionUrl: `/demands/${payload.aggregateId}`,
        dedupeKey: `${this.eventType}:${payload.eventKey}:${personId}`,
        eventAt: event.occurredAt,
      });
    }
    if (!current.todoType) return;
    for (const personId of payload.todoRecipientIds) {
      await createTodo(tx, {
        personId,
        todoType: current.todoType,
        module: "DEMAND",
        aggregateType: "DEMAND",
        aggregateId: payload.aggregateId,
        actionUrl: `/demands/${payload.aggregateId}`,
        dedupeKey: `${current.todoType}:${payload.eventKey}:${personId}`,
        eventKey: payload.eventKey,
      });
    }
  }
}
