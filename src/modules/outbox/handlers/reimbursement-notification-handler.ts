import { createTodo, staleTodos, upsertMessage } from "@/modules/notification/notification-write-service";
import type { OutboxHandler } from "../outbox-handler-registry";

export type ReimbursementEventType =
  | "REIMBURSEMENT_SUBMITTED"
  | "REIMBURSEMENT_RETURNED"
  | "REIMBURSEMENT_VERIFIED"
  | "REIMBURSEMENT_PAPER_RECEIVED"
  | "REIMBURSEMENT_PAPER_INCOMPLETE"
  | "REIMBURSEMENT_FINANCE_SUBMITTED"
  | "REIMBURSEMENT_WITHDRAWN"
  | "REIMBURSEMENT_STATE_CORRECTED";

const messages: Partial<Record<ReimbursementEventType, { title: string; summary: string; audience: "APPLICANT" | "MANAGERS" | "BOTH" }>> = {
  REIMBURSEMENT_SUBMITTED: { title: "报销待线上核对", summary: "有一条报销等待线上核对", audience: "MANAGERS" },
  REIMBURSEMENT_RETURNED: { title: "报销已退回", summary: "你的报销已退回修改", audience: "APPLICANT" },
  REIMBURSEMENT_VERIFIED: { title: "报销已核对", summary: "报销线上核对已完成", audience: "APPLICANT" },
  REIMBURSEMENT_PAPER_RECEIVED: { title: "纸质材料已收取", summary: "纸质材料已收取", audience: "APPLICANT" },
  REIMBURSEMENT_PAPER_INCOMPLETE: { title: "纸质材料不完整", summary: "报销纸质材料不完整，请按要求补充", audience: "APPLICANT" },
  REIMBURSEMENT_FINANCE_SUBMITTED: { title: "纸质材料已提交财务", summary: "纸质材料已提交财务；这不代表审批通过或已经付款", audience: "APPLICANT" },
  REIMBURSEMENT_WITHDRAWN: { title: "报销已撤回", summary: "申请人已撤回报销", audience: "MANAGERS" },
  REIMBURSEMENT_STATE_CORRECTED: { title: "报销状态已纠正", summary: "报销材料流转状态已由管理员纠正", audience: "BOTH" },
};

function recipients(audience: "APPLICANT" | "MANAGERS" | "BOTH", applicantPersonId: string, managerRecipientIds: string[]) {
  return audience === "APPLICANT" ? [applicantPersonId]
    : audience === "MANAGERS" ? managerRecipientIds
    : [...new Set([applicantPersonId, ...managerRecipientIds])];
}

async function addTodo(
  tx: Parameters<OutboxHandler<ReimbursementEventType>["handle"]>[1]["tx"],
  reimbursementId: string,
  personIds: readonly string[],
  todoType: "REIMBURSEMENT_REVIEW" | "REIMBURSEMENT_REVISE" | "REIMBURSEMENT_SUBMIT_FINANCE",
  eventKey: string,
) {
  for (const personId of personIds) {
    await createTodo(tx, {
      personId,
      todoType,
      module: "REIMBURSEMENT",
      aggregateType: "REIMBURSEMENT",
      aggregateId: reimbursementId,
      actionUrl: todoType === "REIMBURSEMENT_REVISE" ? `/reimbursements/${reimbursementId}` : `/reimbursement-admin/${reimbursementId}`,
      dedupeKey: `${todoType}:${reimbursementId}:${personId}:${eventKey}`,
      eventKey,
      reopenStale: true,
    });
  }
}

export class ReimbursementNotificationHandler<T extends ReimbursementEventType> implements OutboxHandler<T> {
  constructor(private readonly eventType: T) {}

  async handle(payload: Parameters<OutboxHandler<T>["handle"]>[0], { tx, event }: Parameters<OutboxHandler<T>["handle"]>[1]) {
    const current = messages[this.eventType];
    if (!current) return;
    await staleTodos(tx, { aggregateType: "REIMBURSEMENT", aggregateId: payload.reimbursementId, now: event.occurredAt });
    for (const personId of recipients(current.audience, payload.applicantPersonId, payload.managerRecipientIds)) {
      await upsertMessage(tx, {
        personId,
        messageType: this.eventType,
        title: current.title,
        summary: current.summary,
        aggregateType: "REIMBURSEMENT",
        aggregateId: payload.reimbursementId,
        actionUrl: personId === payload.applicantPersonId ? `/reimbursements/${payload.reimbursementId}` : `/reimbursement-admin/${payload.reimbursementId}`,
        dedupeKey: `${this.eventType}:${payload.reimbursementId}:${personId}`,
        eventAt: event.occurredAt,
      });
    }

    const target = this.eventType === "REIMBURSEMENT_STATE_CORRECTED" ? payload.toState : undefined;
    if (this.eventType === "REIMBURSEMENT_SUBMITTED" || target === "PENDING_ONLINE_REVIEW") {
      await addTodo(tx, payload.reimbursementId, payload.managerRecipientIds, "REIMBURSEMENT_REVIEW", payload.eventKey);
    } else if (this.eventType === "REIMBURSEMENT_RETURNED" || target === "RETURNED") {
      await addTodo(tx, payload.reimbursementId, [payload.applicantPersonId], "REIMBURSEMENT_REVISE", payload.eventKey);
    } else if (this.eventType === "REIMBURSEMENT_PAPER_RECEIVED" || target === "PAPER_RECEIVED") {
      await addTodo(tx, payload.reimbursementId, payload.managerRecipientIds, "REIMBURSEMENT_SUBMIT_FINANCE", payload.eventKey);
    }
  }
}
