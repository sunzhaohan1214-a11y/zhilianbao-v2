import type { Prisma } from "@/generated/prisma/client";

export async function upsertMessage(tx: Prisma.TransactionClient, input: {
  personId: string;
  messageType: string;
  title: string;
  summary: string;
  aggregateType?: string;
  aggregateId?: string;
  actionUrl?: string;
  dedupeKey: string;
  eventAt?: Date;
}) {
  const eventAt = input.eventAt ?? new Date();
  return tx.message.upsert({
    where: { dedupeKey: input.dedupeKey.slice(0, 191) },
    create: { ...input, dedupeKey: input.dedupeKey.slice(0, 191), eventAt },
    update: {
      title: input.title,
      summary: input.summary,
      actionUrl: input.actionUrl,
      eventAt,
      readAt: null,
    },
  });
}

export async function createTodo(tx: Prisma.TransactionClient, input: {
  personId: string;
  todoType: string;
  module: string;
  aggregateType: string;
  aggregateId: string;
  actionUrl: string;
  dedupeKey: string;
  eventKey?: string;
}) {
  return tx.todo.upsert({
    where: { dedupeKey: input.dedupeKey.slice(0, 191) },
    create: { ...input, dedupeKey: input.dedupeKey.slice(0, 191) },
    update: { actionUrl: input.actionUrl },
  });
}

export function staleTodos(tx: Prisma.TransactionClient, input: {
  aggregateType: string;
  aggregateId: string;
  personIds?: readonly string[];
  todoType?: string;
  now?: Date;
}) {
  return tx.todo.updateMany({
    where: {
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      status: "OPEN",
      ...(input.personIds ? { personId: { in: [...input.personIds] } } : {}),
      ...(input.todoType ? { todoType: input.todoType } : {}),
    },
    data: { status: "STALE", staleAt: input.now ?? new Date() },
  });
}

export function completeTodos(tx: Prisma.TransactionClient, input: {
  aggregateType: string;
  aggregateId: string;
  personIds?: readonly string[];
  todoType?: string;
  now?: Date;
}) {
  return tx.todo.updateMany({
    where: {
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      status: "OPEN",
      ...(input.personIds ? { personId: { in: [...input.personIds] } } : {}),
      ...(input.todoType ? { todoType: input.todoType } : {}),
    },
    data: { status: "COMPLETED", completedAt: input.now ?? new Date() },
  });
}
