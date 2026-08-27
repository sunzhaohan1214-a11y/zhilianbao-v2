import type { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { authorizeActor } from "@/modules/permissions/authorization";
import type { PermissionActor } from "@/modules/permissions/types";
import { NotificationError } from "./errors";
import { notificationListSchema, todoListSchema } from "./schemas";

export class NotificationService {
  private readonly prisma = getPrismaClient();

  private static readonly aggregateTypeByModule = {
    ANNOUNCEMENT: "ANNOUNCEMENT",
    DEMAND: "DEMAND",
    HELP: "HELP_REQUEST",
    TRIP: "TRIP",
    REIMBURSEMENT: "REIMBURSEMENT",
  } as const;

  async listMessages(input: { actor: PermissionActor; query: unknown }) {
    await authorizeActor({ actor: input.actor, action: "message.view.self" });
    const query = notificationListSchema.parse(input.query);
    const where: Prisma.MessageWhereInput = {
      personId: input.actor.personId,
      ...(query.unread === true ? { readAt: null } : {}),
      ...(query.unread === false ? { readAt: { not: null } } : {}),
      ...(query.type ? { messageType: query.type } : {}),
      ...(query.module ? { aggregateType: NotificationService.aggregateTypeByModule[query.module] } : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.message.count({ where }),
      this.prisma.message.findMany({
        where,
        orderBy: [{ eventAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items, total, ...query };
  }

  async readMessage(input: { actor: PermissionActor; messageId: string }) {
    await authorizeActor({ actor: input.actor, action: "message.read.self" });
    const result = await this.prisma.message.updateMany({
      where: { id: input.messageId, personId: input.actor.personId },
      data: { readAt: new Date() },
    });
    if (result.count === 0) throw new NotificationError("MESSAGE_NOT_FOUND", "消息不存在");
    return { id: input.messageId, read: true };
  }

  async readAll(input: { actor: PermissionActor }) {
    await authorizeActor({ actor: input.actor, action: "message.read.self" });
    const result = await this.prisma.message.updateMany({
      where: { personId: input.actor.personId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  async getCounts(actor: PermissionActor): Promise<{ unreadMessageCount: number; openTodoCount: number }> {
    await authorizeActor({ actor, action: "message.view.self" });
    await authorizeActor({ actor, action: "todo.view.self" });
    const [unreadMessageCount, openTodoCount] = await Promise.all([
      this.prisma.message.count({ where: { personId: actor.personId, readAt: null } }),
      this.prisma.todo.count({ where: { personId: actor.personId, status: "OPEN" } }),
    ]);
    return { unreadMessageCount, openTodoCount };
  }

  async listTodos(input: { actor: PermissionActor; query: unknown }) {
    await authorizeActor({ actor: input.actor, action: "todo.view.self" });
    const query = todoListSchema.parse(input.query);
    const where = {
      personId: input.actor.personId,
      status: query.status,
      ...(query.module ? { module: query.module } : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.todo.count({ where }),
      this.prisma.todo.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items, total, ...query };
  }
}
