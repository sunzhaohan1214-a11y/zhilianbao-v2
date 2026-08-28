import { getPrismaClient } from "@/lib/db/prisma";
import { dateOnlyString, isDateDue } from "@/modules/demand/outcome-date";
import { activeAreaStaff } from "@/modules/notification/recipient-resolver";
import { OutboxRepository } from "@/modules/outbox/outbox-repository";
import type { JobHandler } from "../handler-registry";

export class DemandOutcomeDueJobHandler implements JobHandler<"DEMAND_OUTCOME_DUE"> {
  private readonly outbox = new OutboxRepository();

  constructor(
    private readonly prisma = getPrismaClient(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async handle(payload: Parameters<JobHandler<"DEMAND_OUTCOME_DUE">["handle"]>[0]): Promise<void> {
    const now = this.now();
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM demand_outcome_plans WHERE id = ${payload.planId} FOR UPDATE`;
      if (rows.length !== 1) return;
      const plan = await tx.demandOutcomePlan.findUnique({
        where: { id: payload.planId },
        include: { demand: { select: { id: true, status: true, responsibleAreaId: true } }, rounds: { where: { activeKey: 1 }, select: { id: true }, take: 1 } },
      });
      if (!plan || plan.demand.status !== "COMPLETED" || plan.trackingMode !== "TRACKING") return;
      if (!["PENDING", "IN_PROGRESS"].includes(plan.status) || !plan.nextTrackingDate || plan.rounds.length > 0) return;
      if (plan.dueVersion !== payload.dueVersion || dateOnlyString(plan.nextTrackingDate) !== payload.dueDate || !isDateDue(payload.dueDate, now)) return;
      const recipients = await activeAreaStaff(tx, plan.demand.responsibleAreaId, now);
      if (recipients.length === 0) throw new Error(`OUTCOME_AREA_STAFF_CONFIGURATION_MISSING:${plan.demand.id}`);
      await this.outbox.append({
        eventType: "OUTCOME_TRACKING_DUE",
        aggregateType: "DEMAND",
        aggregateId: plan.demand.id,
        payload: { aggregateId: plan.demand.id, recipientIds: recipients, todoRecipientIds: recipients, eventKey: payload.eventKey },
        dedupeKey: `outcome-tracking-due:${plan.id}:${plan.dueVersion}`,
        occurredAt: now,
      }, tx);
    });
  }
}
