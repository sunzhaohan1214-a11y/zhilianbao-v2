import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getPrismaClient } from "@/lib/db/prisma";
import { AttachmentRecoveryService } from "@/modules/attachment/attachment-recovery-service";
import { AttachmentRepository } from "@/modules/attachment/repository/attachment-repository";
import { AttachmentScanService } from "@/modules/attachment/attachment-scan-service";
import { FakeCleanScanner } from "@/modules/attachment/scan/file-scan-adapter";
import { InMemoryStorageAdapter } from "@/modules/attachment/storage/in-memory-storage-adapter";
import { PermanentJobError, RetryableJobError } from "@/modules/jobs/errors";
import { JobHandlerRegistry } from "@/modules/jobs/handler-registry";
import { JobRepository } from "@/modules/jobs/job-repository";
import { JobRunner } from "@/modules/jobs/job-runner";
import { AttachmentUploadedOutboxHandler } from "@/modules/outbox/handlers/attachment-uploaded-handler";
import { DemandParticipationNotificationHandler } from "@/modules/outbox/handlers/demand-participation-notification-handler";
import { OutboxConsumer } from "@/modules/outbox/outbox-consumer";
import { OutboxHandlerRegistry } from "@/modules/outbox/outbox-handler-registry";
import { OutboxRepository } from "@/modules/outbox/outbox-repository";

const prisma = getPrismaClient();
const jobs = new JobRepository(prisma);
const outbox = new OutboxRepository(prisma);
const runId = randomUUID();
const keyPrefix = `m0-006:${runId}`;
const personIds: string[] = [];
const attachmentIds: string[] = [];
const downstreamJobKeys: string[] = [];
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
const noLog = () => undefined;

async function enqueueCleanup(index: string, overrides: { maxRetries?: number; scheduledAt?: Date } = {}) {
  return jobs.enqueue({
    jobType: "ATTACHMENT_TEMP_CLEANUP",
    payload: { limit: 1 },
    idempotencyKey: `${keyPrefix}:job:${index}`,
    maxRetries: overrides.maxRetries,
    scheduledAt: overrides.scheduledAt,
  });
}

afterAll(async () => {
  if (personIds.length > 0) {
    await prisma.todo.deleteMany({ where: { personId: { in: personIds } } });
    await prisma.message.deleteMany({ where: { personId: { in: personIds } } });
  }
  await prisma.outboxEvent.deleteMany({ where: { dedupeKey: { startsWith: keyPrefix } } });
  await prisma.jobTask.deleteMany({ where: { idempotencyKey: { startsWith: keyPrefix } } });
  if (downstreamJobKeys.length > 0) {
    await prisma.jobTask.deleteMany({ where: { idempotencyKey: { in: downstreamJobKeys } } });
  }
  if (attachmentIds.length > 0) {
    await prisma.jobTask.deleteMany({ where: { idempotencyKey: { in: attachmentIds.map((id) => `attachment-scan:${id}`) } } });
    await prisma.attachment.deleteMany({ where: { id: { in: attachmentIds } } });
  }
  if (personIds.length > 0) await prisma.person.deleteMany({ where: { id: { in: personIds } } });
  await prisma.$disconnect();
});

describe("M0-006 Job Queue on real MySQL", () => {
  it("claims 20 jobs across three workers without duplicates", async () => {
    const created = await Promise.all(Array.from({ length: 20 }, (_, index) => enqueueCleanup(`claim:${index}`)));
    const claimed = new Map<string, string>();
    const worker = async (workerId: string) => {
      while (true) {
        const job = await jobs.claimNext(workerId);
        if (!job) return;
        expect(claimed.has(job.id)).toBe(false);
        claimed.set(job.id, workerId);
        expect(await jobs.completeOwned(job.id, workerId)).toBe(true);
      }
    };
    await Promise.all([worker("worker-a"), worker("worker-b"), worker("worker-c")]);
    expect([...claimed.keys()].sort()).toEqual(created.map(({ id }) => id).sort());
    expect(await prisma.jobTask.count({ where: { id: { in: created.map(({ id }) => id) }, status: "SUCCEEDED" } })).toBe(20);
  });

  it("deduplicates ten concurrent enqueue calls at the unique constraint", async () => {
    const idempotencyKey = `${keyPrefix}:job:enqueue-race`;
    const results = await Promise.all(Array.from({ length: 10 }, () => jobs.enqueue({
      jobType: "ATTACHMENT_TEMP_CLEANUP",
      payload: {},
      idempotencyKey,
    })));
    expect(new Set(results.map(({ id }) => id)).size).toBe(1);
    expect(await prisma.jobTask.count({ where: { idempotencyKey } })).toBe(1);
    expect(await jobs.cancelWaiting(results[0].id)).toBe(true);
    expect(await jobs.cancelWaiting(results[0].id)).toBe(false);
    expect((await prisma.jobTask.findUniqueOrThrow({ where: { id: results[0].id } })).status).toBe("CANCELED");
  });

  it("prevents an expired Worker A from overwriting Worker B", async () => {
    const created = await enqueueCleanup("lease-owner", { maxRetries: 3 });
    const claimedA = await jobs.claimNext("worker-a");
    expect(claimedA?.id).toBe(created.id);
    await prisma.jobTask.update({ where: { id: created.id }, data: { lockedAt: new Date(Date.now() - 60_000) } });
    await expect(jobs.recoverStale({
      staleBefore: new Date(Date.now() - 10_000),
      retryPolicy: { baseDelayMs: 0, random: () => 0 },
    })).resolves.toBe(1);
    const claimedB = await jobs.claimNext("worker-b", new Date(Date.now() + 1));
    expect(claimedB?.id).toBe(created.id);
    expect(await jobs.completeOwned(created.id, "worker-a")).toBe(false);
    expect(await jobs.completeOwned(created.id, "worker-b")).toBe(true);
  });

  it("retries twice, succeeds once, and keeps the business result idempotent", async () => {
    const created = await enqueueCleanup("retry-success", { maxRetries: 4 });
    let calls = 0;
    const registry = new JobHandlerRegistry();
    registry.register("ATTACHMENT_TEMP_CLEANUP", { async handle() {
      calls += 1;
      if (calls < 3) throw new RetryableJobError("TEST_TRANSIENT", "temporary");
      await outbox.append({
        eventType: "TEST_ENTITY_CHANGED",
        aggregateType: "TEST",
        aggregateId: runId,
        payload: { entityId: runId },
        dedupeKey: `${keyPrefix}:business-result:retry-success`,
      });
    } });
    const runner = new JobRunner(jobs, registry, 60_000, noLog);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await prisma.jobTask.update({ where: { id: created.id }, data: { scheduledAt: new Date(0) } });
      const claimed = await jobs.claimNext("retry-worker");
      expect(claimed?.id).toBe(created.id);
      await runner.run(claimed!, "retry-worker");
    }
    const finished = await prisma.jobTask.findUniqueOrThrow({ where: { id: created.id } });
    expect(finished).toMatchObject({ status: "SUCCEEDED", retryCount: 2, lastError: null });
    expect(calls).toBe(3);
    await registry.dispatch(finished, "forced-duplicate-worker");
    expect(calls).toBe(4);
    expect(await prisma.outboxEvent.count({ where: { dedupeKey: `${keyPrefix}:business-result:retry-success` } })).toBe(1);
  });

  it("stops at max retries and fails permanent errors immediately", async () => {
    const retrying = await enqueueCleanup("retry-exhausted", { maxRetries: 2 });
    const retryRegistry = new JobHandlerRegistry();
    retryRegistry.register("ATTACHMENT_TEMP_CLEANUP", { async handle() {
      throw new RetryableJobError("ALWAYS_FAIL", "temporary");
    } });
    const retryRunner = new JobRunner(jobs, retryRegistry, 60_000, noLog);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await prisma.jobTask.update({ where: { id: retrying.id }, data: { scheduledAt: new Date(0) } });
      const claimed = await jobs.claimNext("retry-exhausted-worker");
      await retryRunner.run(claimed!, "retry-exhausted-worker");
    }
    expect(await prisma.jobTask.findUniqueOrThrow({ where: { id: retrying.id } })).toMatchObject({
      status: "FAILED",
      retryCount: 2,
    });
    const permanent = await enqueueCleanup("permanent", { maxRetries: 10 });
    const permanentRegistry = new JobHandlerRegistry();
    permanentRegistry.register("ATTACHMENT_TEMP_CLEANUP", { async handle() {
      throw new PermanentJobError("INVALID_TEST_JOB", "permanent");
    } });
    const permanentRunner = new JobRunner(jobs, permanentRegistry, 60_000, noLog);
    await permanentRunner.run((await jobs.claimNext("permanent-worker"))!, "permanent-worker");
    expect(await prisma.jobTask.findUniqueOrThrow({ where: { id: permanent.id } })).toMatchObject({
      status: "FAILED",
      retryCount: 0,
      lastError: "INVALID_TEST_JOB",
    });
  });

  it("recovers a stale SCANNING attachment and completes it on another Worker", async () => {
    const person = await prisma.person.create({ data: { name: `M0-006 ${runId}` } });
    personIds.push(person.id);
    const attachmentId = randomUUID();
    attachmentIds.push(attachmentId);
    const objectKey = `m0-006/${attachmentId}.pdf`;
    await prisma.attachment.create({ data: {
      id: attachmentId,
      originalFilename: "worker-test.pdf",
      extension: "pdf",
      declaredMimeType: "application/pdf",
      expectedSizeBytes: BigInt(PDF.byteLength),
      actualSizeBytes: BigInt(PDF.byteLength),
      bucket: "test-private-bucket",
      region: "ap-test",
      objectKey,
      uploadStatus: "UPLOADED",
      scanStatus: "SCANNING",
      uploadedByPersonId: person.id,
    } });
    await prisma.jobTask.create({ data: {
      jobType: "ATTACHMENT_SCAN",
      payloadJson: { attachmentId },
      status: "RUNNING",
      idempotencyKey: `attachment-scan:${attachmentId}`,
      scheduledAt: new Date(0),
      lockedAt: new Date(Date.now() - 60_000),
      lockedBy: "crashed-worker",
      maxRetries: 3,
    } });
    const recovery = new AttachmentRecoveryService();
    await expect(jobs.recoverStale({
      staleBefore: new Date(Date.now() - 10_000),
      retryPolicy: { baseDelayMs: 0, random: () => 0 },
      onRecover: async (tx, job) => {
        await recovery.recoverStaleScan(tx, attachmentId);
        expect(job.jobType).toBe("ATTACHMENT_SCAN");
      },
    })).resolves.toBe(1);
    expect(await prisma.attachment.findUniqueOrThrow({ where: { id: attachmentId } })).toMatchObject({
      scanStatus: "FAILED",
      scanReason: "STALE_SCAN_RECOVERED",
    });

    const storage = new InMemoryStorageAdapter({ bucket: "test-private-bucket", region: "ap-test" });
    storage.putObjectForTest(objectKey, PDF);
    const scanService = new AttachmentScanService(new AttachmentRepository(), storage, new FakeCleanScanner());
    const handlers = new JobHandlerRegistry();
    handlers.register("ATTACHMENT_SCAN", { handle: ({ attachmentId: id }) => scanService.processAttachmentScan(id).then(() => undefined) });
    const claimed = await jobs.claimNext("replacement-worker", new Date(Date.now() + 1));
    await new JobRunner(jobs, handlers, 60_000, noLog).run(claimed!, "replacement-worker");
    expect(await prisma.jobTask.findUniqueOrThrow({ where: { idempotencyKey: `attachment-scan:${attachmentId}` } })).toMatchObject({ status: "SUCCEEDED" });
    expect((await prisma.attachment.findUniqueOrThrow({ where: { id: attachmentId } })).scanStatus).toBe("PASSED");
  });
});

describe("M0-006 Transactional Outbox on real MySQL", () => {
  it("retries Claim collaboration delivery and keeps request-scoped messages and todos exact once", async () => {
    const people = await Promise.all(["staff", "owner", "applicant", "invitee", "removed"].map((name) =>
      prisma.person.create({ data: { name: `C-M3-003 ${name} ${runId}` } })));
    personIds.push(...people.map(({ id }) => id));
    const [staff, owner, applicant, invitee, removed] = people;
    const demandId = randomUUID();
    const applyId = randomUUID();
    const otherApplyId = randomUUID();
    const inviteId = randomUUID();
    const base = new Date("2000-01-01T00:00:00.000Z");
    const events = [
      ["DEMAND_CLAIMED", [staff.id], [], undefined, demandId],
      ["COLLABORATION_APPLIED", [owner.id], [owner.id], undefined, applyId],
      ["COLLABORATION_APPLIED", [owner.id], [owner.id], undefined, otherApplyId],
      ["COLLABORATION_INVITED", [invitee.id], [invitee.id], undefined, inviteId],
      ["COLLABORATION_APPROVED", [applicant.id], [], [owner.id], applyId],
      ["COLLABORATION_ACCEPTED", [owner.id], [], [invitee.id], inviteId],
      ["COLLABORATOR_LEFT", [owner.id], [], undefined, randomUUID()],
      ["COLLABORATOR_REMOVED", [removed.id], [], undefined, randomUUID()],
    ] as const;
    const created = [];
    for (const [index, [eventType, recipientIds, todoRecipientIds, staleTodoRecipientIds, eventKey]] of events.entries()) {
      created.push(await outbox.append({
        eventType,
        aggregateType: "DEMAND",
        aggregateId: demandId,
        payload: { aggregateId: demandId, recipientIds: [...recipientIds], todoRecipientIds: [...todoRecipientIds], ...(staleTodoRecipientIds ? { staleTodoRecipientIds: [...staleTodoRecipientIds] } : {}), eventKey },
        dedupeKey: `${keyPrefix}:participation:${index}`,
        occurredAt: new Date(base.getTime() + index),
      }));
    }
    const registry = new OutboxHandlerRegistry();
    let firstAttempt = true;
    for (const eventType of ["DEMAND_CLAIMED", "COLLABORATION_APPLIED", "COLLABORATION_INVITED", "COLLABORATION_APPROVED", "COLLABORATION_ACCEPTED", "COLLABORATOR_LEFT", "COLLABORATOR_REMOVED"] as const) {
      const handler = new DemandParticipationNotificationHandler(eventType);
      registry.register(eventType, eventType === "DEMAND_CLAIMED" ? { async handle(payload, context) {
        if (firstAttempt) { firstAttempt = false; throw new Error("TRANSIENT_NOTIFICATION_FAILURE"); }
        await handler.handle(payload, context);
      } } : handler);
    }
    const consumer = new OutboxConsumer(registry, 3, noLog, prisma, { baseDelayMs: 0, random: () => 0 });
    await consumer.consumeOne(base);
    expect(await prisma.outboxEvent.findUniqueOrThrow({ where: { id: created[0].id } })).toMatchObject({ attempts: 1, publishedAt: null });
    await prisma.outboxEvent.update({ where: { id: created[0].id }, data: { nextAttemptAt: new Date(0) } });
    await consumer.consumeBatch(events.length + 1, new Date(base.getTime() + 60_000));

    expect(await prisma.message.count({ where: { personId: { in: people.map(({ id }) => id) }, aggregateId: demandId } })).toBe(events.length);
    expect(await prisma.todo.findFirstOrThrow({ where: { personId: owner.id, eventKey: applyId } })).toMatchObject({ todoType: "COLLABORATION_REVIEW", status: "STALE" });
    expect(await prisma.todo.findFirstOrThrow({ where: { personId: owner.id, eventKey: otherApplyId } })).toMatchObject({ todoType: "COLLABORATION_REVIEW", status: "OPEN" });
    expect(await prisma.todo.findFirstOrThrow({ where: { personId: invitee.id, eventKey: inviteId } })).toMatchObject({ todoType: "COLLABORATION_INVITE_RESPONSE", status: "STALE" });
    expect(await prisma.todo.count({ where: { aggregateId: demandId } })).toBe(3);
    expect(await prisma.message.count({ where: { personId: staff.id, messageType: "DEMAND_CLAIMED", aggregateId: demandId } })).toBe(1);

    await prisma.outboxEvent.update({ where: { id: created[0].id }, data: { publishedAt: null, nextAttemptAt: new Date(0) } });
    await consumer.consumeOne(new Date(base.getTime() + 120_000));
    expect(await prisma.message.count({ where: { personId: staff.id, messageType: "DEMAND_CLAIMED", aggregateId: demandId } })).toBe(1);
  });

  it("rolls business data and Outbox back together, then commits them together", async () => {
    const rolledPersonId = randomUUID();
    const rollbackKey = `${keyPrefix}:outbox:rollback`;
    await expect(prisma.$transaction(async (tx) => {
      await tx.person.create({ data: { id: rolledPersonId, name: "rollback" } });
      await outbox.append({
        eventType: "TEST_ENTITY_CHANGED",
        aggregateType: "PERSON",
        aggregateId: rolledPersonId,
        payload: { entityId: rolledPersonId },
        dedupeKey: rollbackKey,
      }, tx);
      throw new Error("ROLLBACK_TEST");
    })).rejects.toThrow("ROLLBACK_TEST");
    expect(await prisma.person.count({ where: { id: rolledPersonId } })).toBe(0);
    expect(await prisma.outboxEvent.count({ where: { dedupeKey: rollbackKey } })).toBe(0);

    const committedPersonId = randomUUID();
    personIds.push(committedPersonId);
    const commitKey = `${keyPrefix}:outbox:commit`;
    await prisma.$transaction(async (tx) => {
      await tx.person.create({ data: { id: committedPersonId, name: "commit" } });
      await outbox.append({
        eventType: "TEST_ENTITY_CHANGED",
        aggregateType: "PERSON",
        aggregateId: committedPersonId,
        payload: { entityId: committedPersonId },
        dedupeKey: commitKey,
      }, tx);
    });
    expect(await prisma.person.count({ where: { id: committedPersonId } })).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { dedupeKey: commitKey } })).toBe(1);
  });

  it("deduplicates concurrent appends and publishes 20 events once across three consumers", async () => {
    const dedupeKey = `${keyPrefix}:outbox:dedupe-race`;
    const deduped = await Promise.all(Array.from({ length: 10 }, () => outbox.append({
      eventType: "TEST_ENTITY_CHANGED",
      aggregateType: "TEST",
      aggregateId: runId,
      payload: { entityId: runId },
      dedupeKey,
    })));
    expect(new Set(deduped.map(({ id }) => id)).size).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { dedupeKey } })).toBe(1);

    const events = await Promise.all(Array.from({ length: 20 }, (_, index) => {
      const attachmentId = randomUUID();
      downstreamJobKeys.push(`attachment-scan:${attachmentId}`);
      return outbox.append({
        eventType: "ATTACHMENT_UPLOADED",
        aggregateType: "ATTACHMENT",
        aggregateId: attachmentId,
        payload: { attachmentId },
        dedupeKey: `${keyPrefix}:outbox:consume:${index}`,
      });
    }));
    const registry = new OutboxHandlerRegistry();
    registry.register("ATTACHMENT_UPLOADED", new AttachmentUploadedOutboxHandler(jobs));
    const consumers = ["a", "b", "c"].map(() => new OutboxConsumer(registry, 3, noLog, prisma));
    await Promise.all(consumers.map(async (consumer) => {
      while (await consumer.consumeOne()) { /* consume until empty */ }
    }));
    expect(await prisma.outboxEvent.count({ where: { id: { in: events.map(({ id }) => id) }, publishedAt: { not: null } } })).toBe(20);
    const downstream = await prisma.jobTask.findMany({
      where: { idempotencyKey: { in: events.map((event) => `attachment-scan:${event.aggregateId}`) } },
    });
    expect(downstream).toHaveLength(20);

    const repeated = events[0];
    await prisma.outboxEvent.update({ where: { id: repeated.id }, data: { publishedAt: null, nextAttemptAt: null } });
    await consumers[0].consumeOne();
    expect(await prisma.jobTask.count({ where: { idempotencyKey: `attachment-scan:${repeated.aggregateId}` } })).toBe(1);
  });

  it("backs off poison events and stops at the configured attempt limit", async () => {
    const event = await outbox.append({
      eventType: "TEST_ENTITY_CHANGED",
      aggregateType: "TEST",
      aggregateId: runId,
      payload: { entityId: runId },
      dedupeKey: `${keyPrefix}:outbox:poison`,
    });
    const registry = new OutboxHandlerRegistry();
    registry.register("TEST_ENTITY_CHANGED", { async handle() { throw new Error("sensitive body must not persist"); } });
    const consumer = new OutboxConsumer(registry, 2, noLog, prisma, { baseDelayMs: 0, random: () => 0 });
    await consumer.consumeOne();
    await prisma.outboxEvent.update({ where: { id: event.id }, data: { nextAttemptAt: new Date(0) } });
    await consumer.consumeOne();
    const failed = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(failed.attempts).toBe(2);
    expect(failed.failedAt).not.toBeNull();
    expect(failed.publishedAt).toBeNull();
    expect(failed.lastError).toBe("OUTBOX_HANDLER_ERROR");
  });
});
