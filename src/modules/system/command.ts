import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { SystemError } from "./errors";

export function stableHash(value: unknown): string {
  const canonical = (input: unknown): unknown => Array.isArray(input) ? input.map(canonical) : input && typeof input === "object" ? Object.fromEntries(Object.entries(input).filter(([, child]) => child !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonical(child)])) : input;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
export function requireIdempotencyKey(value: string | null | undefined): string {
  const key = value?.trim();
  if (!key || key.length > 200) throw new SystemError("SYSTEM_IDEMPOTENCY_REQUIRED", "必须提供有效 Idempotency-Key");
  return createHash("sha256").update(key).digest("hex");
}
export async function findSystemCommand(tx: Prisma.TransactionClient, input: { actorPersonId: string; action: string; keyHash: string; payloadHash: string }) {
  const found = await tx.systemCommandIdempotency.findUnique({ where: { actorPersonId_action_keyHash: { actorPersonId: input.actorPersonId, action: input.action, keyHash: input.keyHash } } });
  if (found && found.payloadHash !== input.payloadHash) throw new SystemError("SYSTEM_IDEMPOTENCY_CONFLICT", "Idempotency-Key 已用于不同系统命令");
  return found;
}
export async function saveSystemCommand(tx: Prisma.TransactionClient, input: { actorPersonId: string; action: string; keyHash: string; payloadHash: string; aggregateType: string; aggregateId?: string | null; response: Prisma.InputJsonValue }) {
  await tx.systemCommandIdempotency.create({ data: { actorPersonId: input.actorPersonId, action: input.action, keyHash: input.keyHash, payloadHash: input.payloadHash, aggregateType: input.aggregateType, aggregateId: input.aggregateId ?? null, responseJson: input.response } });
}
