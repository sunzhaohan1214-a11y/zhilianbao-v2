import { createTodo, staleTodos, upsertMessage } from "@/modules/notification/notification-write-service";
import type { OutboxHandler } from "../outbox-handler-registry";

type EventType =
  | "DEMAND_SUBMITTED_REVIEW" | "DEMAND_REVIEW_RETURNED" | "DEMAND_PUBLISHED"
  | "HELP_TRANSFERRED_ORG" | "HELP_ASSIGNED_PERSON" | "HELP_CLAIMED"
  | "HELP_COMPLETED" | "HELP_REOPENED" | "HELP_REASSIGNED" | "HELP_WITHDRAWN";

const config: Record<EventType, {
  aggregateType: "DEMAND" | "HELP_REQUEST";
  module: "DEMAND" | "HELP";
  title: string;
  summary: string;
  todoType?: string;
  actionPrefix: string;
}> = {
  DEMAND_SUBMITTED_REVIEW: { aggregateType: "DEMAND", module: "DEMAND", title: "需求待审核", summary: "有一条正式需求等待审核", todoType: "DEMAND_REVIEW", actionPrefix: "/admin/demands" },
  DEMAND_REVIEW_RETURNED: { aggregateType: "DEMAND", module: "DEMAND", title: "需求已退回", summary: "正式需求需要修改后重新提交", todoType: "DEMAND_REVISE", actionPrefix: "/demands" },
  DEMAND_PUBLISHED: { aggregateType: "DEMAND", module: "DEMAND", title: "需求已发布", summary: "正式需求已通过审核并发布", actionPrefix: "/demands" },
  HELP_TRANSFERRED_ORG: { aggregateType: "HELP_REQUEST", module: "HELP", title: "求助待接手", summary: "所属组织有一条办事求助等待接手", todoType: "HELP_CLAIM", actionPrefix: "/help-requests" },
  HELP_ASSIGNED_PERSON: { aggregateType: "HELP_REQUEST", module: "HELP", title: "求助已指派", summary: "你有一条办事求助需要处理", todoType: "HELP_PROCESS", actionPrefix: "/help-requests" },
  HELP_CLAIMED: { aggregateType: "HELP_REQUEST", module: "HELP", title: "求助已接手", summary: "办事求助已有主办人接手", todoType: "HELP_PROCESS", actionPrefix: "/help-requests" },
  HELP_COMPLETED: { aggregateType: "HELP_REQUEST", module: "HELP", title: "求助已办结", summary: "你提交的办事求助已办结", actionPrefix: "/help-requests" },
  HELP_REOPENED: { aggregateType: "HELP_REQUEST", module: "HELP", title: "求助已重新打开", summary: "办事求助需要继续处理", todoType: "HELP_PROCESS", actionPrefix: "/help-requests" },
  HELP_REASSIGNED: { aggregateType: "HELP_REQUEST", module: "HELP", title: "求助已重新分派", summary: "办事求助的主办人已变更", todoType: "HELP_PROCESS", actionPrefix: "/help-requests" },
  HELP_WITHDRAWN: { aggregateType: "HELP_REQUEST", module: "HELP", title: "求助已撤回", summary: "办事求助已撤回", actionPrefix: "/help-requests" },
};

export class BusinessNotificationHandler<T extends EventType> implements OutboxHandler<T> {
  constructor(private readonly eventType: T) {}

  async handle(payload: Parameters<OutboxHandler<T>["handle"]>[0], { tx, event }: Parameters<OutboxHandler<T>["handle"]>[1]) {
    const current = config[this.eventType];
    await staleTodos(tx, {
      aggregateType: current.aggregateType,
      aggregateId: payload.aggregateId,
      ...(payload.staleTodoRecipientIds ? { personIds: payload.staleTodoRecipientIds } : {}),
      now: event.occurredAt,
    });
    for (const personId of payload.recipientIds) {
      await upsertMessage(tx, {
        personId,
        messageType: this.eventType,
        title: current.title,
        summary: current.summary,
        aggregateType: current.aggregateType,
        aggregateId: payload.aggregateId,
        actionUrl: `${current.actionPrefix}/${payload.aggregateId}`,
        dedupeKey: `${this.eventType}:${payload.aggregateId}:${personId}`,
        eventAt: event.occurredAt,
      });
    }
    if (!current.todoType) return;
    for (const personId of payload.todoRecipientIds) {
      await createTodo(tx, {
        personId,
        todoType: current.todoType,
        module: current.module,
        aggregateType: current.aggregateType,
        aggregateId: payload.aggregateId,
        actionUrl: `${current.actionPrefix}/${payload.aggregateId}`,
        dedupeKey: `${current.todoType}:${payload.aggregateId}:${personId}:${payload.eventKey}`,
        eventKey: payload.eventKey,
      });
    }
  }
}
