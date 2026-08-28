import { createTodo, staleTodos, upsertMessage } from "@/modules/notification/notification-write-service";
import type { OutboxHandler } from "../outbox-handler-registry";
import type { OutboxEventType } from "../outbox-types";

export const DEMAND_LIFECYCLE_NOTIFICATION_EVENTS = [
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
] as const satisfies readonly OutboxEventType[];

type EventType = (typeof DEMAND_LIFECYCLE_NOTIFICATION_EVENTS)[number];
type Payload = {
  aggregateId: string;
  recipientIds: string[];
  todoRecipientIds: string[];
  staleTodoRecipientIds?: string[];
  eventKey: string;
};

const messages: Partial<Record<EventType, { title: string; summary: string }>> = {
  TEAM_COORDINATOR_STALE_REMINDER: { title: "进展更新提醒", summary: "这条需求已久未更新，请补充当前进展" },
  DEMAND_CLOSE_SUBMITTED: { title: "待办结审核", summary: "有一条需求待办结审核" },
  DEMAND_CLOSE_RETURNED: { title: "办结申请已退回", summary: "需求办结申请已退回，请补充后重新提交" },
  DEMAND_COMPLETED: { title: "需求已办结", summary: "需求已完成镇区核实和管理员办结审核" },
  DEMAND_OWNER_EXIT_REQUESTED: { title: "负责人申请退出", summary: "有一条需求的负责人退出申请待审核" },
  DEMAND_OWNER_EXIT_APPROVED: { title: "负责人退出已通过", summary: "负责人退出申请已通过，需求已回到待对接" },
  DEMAND_OWNER_EXIT_REJECTED: { title: "负责人退出未通过", summary: "负责人退出申请未通过，原负责人继续负责" },
  DEMAND_OWNER_TRANSFERRED: { title: "需求负责人已转交", summary: "需求负责人转交已立即生效" },
  DEMAND_CANCELED: { title: "需求已取消", summary: "需求已按线下沟通结果取消" },
};

async function staleTypes(
  tx: Parameters<typeof staleTodos>[0],
  aggregateId: string,
  todoTypes: readonly string[],
  personIds?: readonly string[],
  now?: Date,
) {
  for (const todoType of todoTypes) await staleTodos(tx, { aggregateType: "DEMAND", aggregateId, todoType, personIds, now });
}

function todoType(eventType: EventType): string | null {
  if (eventType === "TEAM_COORDINATOR_STALE_REMINDER") return "DEMAND_UPDATE_STALE";
  if (eventType === "DEMAND_CLOSE_SUBMITTED") return "DEMAND_CLOSE_REVIEW";
  if (eventType === "DEMAND_CLOSE_RETURNED") return "DEMAND_CONTINUE";
  if (eventType === "DEMAND_OWNER_EXIT_REQUESTED") return "DEMAND_OWNER_EXIT_REVIEW";
  return null;
}

export class DemandProgressCloseNotificationHandler implements OutboxHandler<EventType> {
  constructor(private readonly eventType: EventType) {}

  async handle(payload: Payload, { event, tx }: Parameters<OutboxHandler<EventType>["handle"]>[1]): Promise<void> {
    if (this.eventType === "DEMAND_PROGRESS_ADDED") {
      await staleTypes(tx, payload.aggregateId, ["DEMAND_UPDATE_STALE", "DEMAND_CONTINUE"], undefined, event.occurredAt);
      return;
    }
    if (this.eventType === "DEMAND_CLOSE_SUBMITTED") {
      await staleTypes(tx, payload.aggregateId, ["DEMAND_UPDATE_STALE", "DEMAND_CONTINUE"], undefined, event.occurredAt);
    }
    if (["DEMAND_COMPLETED", "DEMAND_OWNER_EXIT_APPROVED", "DEMAND_CANCELED"].includes(this.eventType)) {
      await staleTypes(tx, payload.aggregateId, ["DEMAND_UPDATE_STALE", "DEMAND_CONTINUE", "DEMAND_CLOSE_REVIEW", "DEMAND_OWNER_EXIT_REVIEW"], undefined, event.occurredAt);
    }
    if (this.eventType === "DEMAND_OWNER_EXIT_REJECTED") {
      await staleTypes(tx, payload.aggregateId, ["DEMAND_OWNER_EXIT_REVIEW"], undefined, event.occurredAt);
    }
    if (this.eventType === "DEMAND_OWNER_TRANSFERRED" && payload.staleTodoRecipientIds?.length) {
      await staleTypes(tx, payload.aggregateId, ["DEMAND_UPDATE_STALE", "DEMAND_CONTINUE"], payload.staleTodoRecipientIds, event.occurredAt);
    }

    const message = messages[this.eventType];
    if (message) {
      for (const personId of payload.recipientIds) await upsertMessage(tx, {
        personId,
        messageType: this.eventType,
        title: message.title,
        summary: message.summary,
        aggregateType: "DEMAND",
        aggregateId: payload.aggregateId,
        actionUrl: `/demands/${payload.aggregateId}`,
        dedupeKey: `${this.eventType}:DEMAND:${payload.aggregateId}:${personId}`,
        eventAt: event.occurredAt,
      });
    }

    const type = todoType(this.eventType);
    if (!type) return;
    for (const personId of payload.todoRecipientIds) await createTodo(tx, {
      personId,
      todoType: type,
      module: "DEMAND",
      aggregateType: "DEMAND",
      aggregateId: payload.aggregateId,
      actionUrl: `/demands/${payload.aggregateId}`,
      dedupeKey: `DEMAND:${payload.aggregateId}:${type}:${personId}`,
      eventKey: payload.eventKey,
      reopenStale: true,
    });
  }
}
