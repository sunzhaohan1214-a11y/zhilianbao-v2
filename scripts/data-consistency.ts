import { mkdir, writeFile } from "node:fs/promises";
import { disconnectPrismaClient, getPrismaClient } from "../src/lib/db/prisma.ts";

type Row = { id: string };
type Check = { code: string; status: "PASS" | "FAIL"; count: number; sampleIds: string[] };
const prisma = getPrismaClient();

function result(code: string, rows: Row[], expected = 0): Check {
  return { code, status: rows.length === expected ? "PASS" : "FAIL", count: rows.length, sampleIds: rows.slice(0, 20).map(({ id }) => id) };
}

try {
  const currentBatches = await prisma.$queryRaw<Row[]>`SELECT id FROM batches WHERE status = 'ACTIVE' AND is_current = 1`;
  const demandOwner = await prisma.$queryRaw<Row[]>`
    SELECT d.id FROM demands d
    LEFT JOIN demand_owner_histories h ON h.demand_id = d.id AND h.active_key = 1
    WHERE (d.current_owner_person_id IS NULL AND h.id IS NOT NULL)
       OR (d.current_owner_person_id IS NOT NULL AND (h.id IS NULL OR h.person_id <> d.current_owner_person_id))`;
  const alumniHelpers = await prisma.$queryRaw<Row[]>`
    SELECT id FROM demand_alumni_helpers
    WHERE (active_key = 1 AND (status <> 'ACTIVE' OR expired_at IS NOT NULL))
       OR (active_key IS NULL AND status = 'ACTIVE' AND expired_at IS NULL)`;
  const primaryContacts = await prisma.$queryRaw<Row[]>`
    SELECT e.id FROM enterprises e
    LEFT JOIN enterprise_contacts c ON c.id = e.primary_contact_id
    WHERE (e.primary_contact_id IS NOT NULL AND (c.id IS NULL OR c.enterprise_id <> e.id OR c.status <> 'ACTIVE' OR c.is_primary <> 1))
       OR EXISTS (SELECT 1 FROM enterprise_contacts p WHERE p.enterprise_id = e.id AND p.status = 'ACTIVE' AND p.is_primary = 1 AND (e.primary_contact_id IS NULL OR e.primary_contact_id <> p.id))`;
  const talentRounds = await prisma.$queryRaw<Row[]>`
    SELECT id FROM talent_township_rounds
    WHERE (active_key = 1 AND (status <> 'IN_PROGRESS' OR completed_at IS NOT NULL OR withdrawn_at IS NOT NULL OR voided_at IS NOT NULL))
       OR (status = 'IN_PROGRESS' AND voided_at IS NULL AND active_key IS NULL)`;
  const helpOwners = await prisma.$queryRaw<Row[]>`
    SELECT h.id FROM help_requests h
    LEFT JOIN help_assignment_history a ON a.help_request_id = h.id AND a.active_key = 1
    WHERE (h.current_owner_person_id IS NULL AND h.transferred_organization_id IS NULL AND a.id IS NOT NULL)
       OR (h.current_owner_person_id IS NOT NULL AND (a.id IS NULL OR a.person_id <> h.current_owner_person_id))
       OR (h.transferred_organization_id IS NOT NULL AND (a.id IS NULL OR a.organization_id <> h.transferred_organization_id))`;
  const duplicateTodos = await prisma.$queryRaw<Row[]>`
    SELECT MIN(id) AS id FROM todos WHERE status = 'OPEN' GROUP BY dedupe_key HAVING COUNT(*) > 1`;
  const attachmentMetadata = await prisma.$queryRaw<Row[]>`
    SELECT id FROM attachments WHERE upload_status = 'UPLOADED'
      AND (actual_size_bytes IS NULL OR sha256 IS NULL OR detected_mime_type IS NULL OR detected_file_type IS NULL OR object_key IS NULL)`;
  const monthlyExports = await prisma.$queryRaw<Row[]>`
    SELECT t.id FROM monthly_report_export_tasks t
    LEFT JOIN attachment_links l ON l.attachment_id = t.output_attachment_id
      AND l.entity_type = 'MONTHLY_REPORT_EXPORT_TASK' AND l.entity_id = t.id
    WHERE t.status = 'SUCCEEDED' AND (t.output_attachment_id IS NULL OR l.id IS NULL)`;
  const activeRestores = await prisma.$queryRaw<Row[]>`SELECT id FROM restore_requests WHERE active_key IS NOT NULL`;

  const checks = [
    result("EXACTLY_ONE_CURRENT_ACTIVE_BATCH", currentBatches, 1),
    result("DEMAND_OWNER_HISTORY_MATCH", demandOwner),
    result("ALUMNI_HELPER_ACTIVE_STATE_MATCH", alumniHelpers),
    result("ENTERPRISE_PRIMARY_CONTACT_MATCH", primaryContacts),
    result("TALENT_ACTIVE_ROUND_MATCH", talentRounds),
    result("HELP_OWNER_HISTORY_MATCH", helpOwners),
    result("OPEN_TODO_DEDUPE_UNIQUE", duplicateTodos),
    result("UPLOADED_ATTACHMENT_METADATA_COMPLETE", attachmentMetadata),
    result("MONTHLY_EXPORT_ATTACHMENT_LINKED", monthlyExports),
    { code: "AT_MOST_ONE_ACTIVE_RESTORE", status: activeRestores.length <= 1 ? "PASS" : "FAIL", count: activeRestores.length, sampleIds: activeRestores.slice(0, 20).map(({ id }) => id) } as Check,
  ];
  const report = { status: checks.every(({ status }) => status === "PASS") ? "PASS" : "FAIL", generatedAt: new Date().toISOString(), readOnly: true, checks };
  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/data-consistency.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report));
  if (report.status !== "PASS") process.exitCode = 1;
} finally {
  await disconnectPrismaClient();
}
