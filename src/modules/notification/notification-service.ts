import { getPrismaClient } from "@/lib/db/prisma";
import { authorizeActor } from "@/modules/permissions/authorization";
import type { PermissionActor } from "@/modules/permissions/types";
import { NotificationError } from "./errors";
import { notificationListSchema, todoListSchema } from "./schemas";

export class NotificationService {
  private readonly prisma = getPrismaClient();

  async listMessages(input: { actor: PermissionActor; query: unknown }) {
    await authorizeActor({ actor: input.actor, action: "message.view.self" });
    const query = notificationListSchema.parse(input.query);
    const where = { personId: input.actor.personId };
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
