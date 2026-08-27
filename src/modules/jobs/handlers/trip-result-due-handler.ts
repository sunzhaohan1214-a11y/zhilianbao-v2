import { getPrismaClient } from "@/lib/db/prisma";
import { createTodo, upsertMessage } from "@/modules/notification/notification-write-service";
import { effectiveTripEnd } from "@/modules/trip/status";
import type { JobHandler } from "../handler-registry";

export class TripResultDueJobHandler implements JobHandler<"TRIP_RESULT_DUE"> {
  constructor(
    private readonly prisma = getPrismaClient(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async handle(payload: Parameters<JobHandler<"TRIP_RESULT_DUE">["handle"]>[0]): Promise<void> {
    const now = this.now();
    await this.prisma.$transaction(async (tx) => {
      const trip = await tx.trip.findUnique({
        where: { id: payload.tripId },
        include: {
          result: { select: { id: true } },
          nodes: { select: { plannedStartAt: true, plannedEndAt: true } },
          participants: { where: { leftAt: null }, select: { personId: true } },
        },
      });
      if (!trip || trip.canceledAt || trip.result) return;
      const currentDueAt = effectiveTripEnd(trip);
      if (currentDueAt.toISOString() !== payload.dueAt || now <= currentDueAt) return;
      for (const { personId } of trip.participants) {
        await upsertMessage(tx, {
          personId,
          messageType: "TRIP_RESULT_DUE",
          title: "行程待补充结果",
          summary: "你参与的一项行程需要补充共享结果",
          aggregateType: "TRIP",
          aggregateId: trip.id,
          actionUrl: `/trips/${trip.id}`,
          dedupeKey: `TRIP_RESULT_DUE:${trip.id}:${personId}`,
          eventAt: now,
        });
        await createTodo(tx, {
          personId,
          todoType: "TRIP_RESULT",
          module: "TRIP",
          aggregateType: "TRIP",
          aggregateId: trip.id,
          actionUrl: `/trips/${trip.id}`,
          dedupeKey: `TRIP_RESULT:${trip.id}:${personId}`,
          eventKey: payload.eventKey,
        });
      }
    });
  }
}
