import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getPrismaClient } from "@/lib/db/prisma";

const prisma = getPrismaClient();

function uniquePhone(): string {
  return `1${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`;
}

async function createPerson(name: string) {
  return prisma.person.create({ data: { name: `${name}-${randomUUID()}` } });
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe("M0-002 database foundation", () => {
  it("enforces one Account per Person and unique phone", async () => {
    const firstPerson = await createPerson("account-owner");
    const secondPerson = await createPerson("phone-owner");
    const phone = uniquePhone();

    await prisma.account.create({
      data: {
        personId: firstPerson.id,
        phone,
        passwordHash: "test-hash-not-a-real-password",
      },
    });

    await expect(
      prisma.account.create({
        data: {
          personId: firstPerson.id,
          phone: uniquePhone(),
          passwordHash: "test-hash-not-a-real-password",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    await expect(
      prisma.account.create({
        data: {
          personId: secondPerson.id,
          phone,
          passwordHash: "test-hash-not-a-real-password",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("enforces one BatchMembership per Person and Batch", async () => {
    const person = await createPerson("batch-member");
    const batch = await prisma.batch.create({
      data: {
        name: `batch-${randomUUID()}`,
        year: 2026,
        startDate: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    const membership = {
      personId: person.id,
      batchId: batch.id,
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      status: "ACTIVE",
    };

    await prisma.batchMembership.create({ data: membership });
    await expect(
      prisma.batchMembership.create({ data: membership }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("stores MINISTER only as an independent RoleAssignment code", async () => {
    const minister = await createPerson("minister");
    const grantor = await createPerson("minister-grantor");

    const assignment = await prisma.roleAssignment.create({
      data: {
        personId: minister.id,
        roleCode: "MINISTER",
        effectiveAt: new Date(),
        grantedByPersonId: grantor.id,
        reason: "database integration test",
      },
    });

    expect(assignment.roleCode).toBe("MINISTER");
    expect(await prisma.groupLeaderAssignment.count({ where: { personId: minister.id } })).toBe(0);

    const ministerTables = await prisma.$queryRaw<Array<{ tableName: string }>>`
      SELECT TABLE_NAME AS tableName
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN ('minister_accounts', 'minister_profiles', 'minister_assignments')
    `;
    expect(ministerTables).toEqual([]);
  });

  it("keeps Organization and AdministrativeArea separate and maps them with real foreign keys", async () => {
    const organization = await prisma.organization.create({
      data: {
        name: `department-${randomUUID()}`,
        type: "DEPARTMENT",
      },
    });
    const area = await prisma.administrativeArea.create({
      data: {
        name: `area-${randomUUID()}`,
        type: "HIGH_TECH_ZONE",
      },
    });
    const effectiveAt = new Date();

    const mapping = await prisma.organizationAreaMapping.create({
      data: { organizationId: organization.id, areaId: area.id, effectiveAt },
    });
    const relation = await prisma.departmentTownshipRelation.create({
      data: {
        departmentOrganizationId: organization.id,
        areaId: area.id,
        effectiveAt,
      },
    });

    expect(mapping.organizationId).toBe(organization.id);
    expect(mapping.areaId).toBe(area.id);
    expect(relation.areaId).toBe(area.id);
    expect(organization.id).not.toBe(area.id);

    const relationColumns = await prisma.$queryRaw<Array<{ columnName: string }>>`
      SELECT COLUMN_NAME AS columnName
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'department_township_relations'
    `;
    expect(relationColumns.map(({ columnName }) => columnName)).toContain("area_id");
    expect(relationColumns.map(({ columnName }) => columnName)).not.toContain("area_ids");
  });

  it("enforces the BusinessSequence prefix and year key", async () => {
    const prefix = `T${randomUUID().slice(0, 5)}`;
    const sequence = { prefix, year: 2026 };

    await prisma.businessSequence.create({ data: sequence });
    await expect(
      prisma.businessSequence.create({ data: sequence }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("enforces JobTask idempotencyKey uniqueness", async () => {
    const idempotencyKey = randomUUID();
    const task = {
      jobType: "DATABASE_TEST",
      payloadJson: { test: true },
      idempotencyKey,
      scheduledAt: new Date(),
    };

    await prisma.jobTask.create({ data: task });
    await expect(prisma.jobTask.create({ data: task })).rejects.toMatchObject({
      code: "P2002",
    });
  });
});
