import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { privateAttachmentRelativePath, resolvePrivateAttachmentDestination } from "./private-attachment-path";
import { assertPrivateMigrationOutput } from "./private-output-guard";
import { GOVERNANCE_ISSUES_FILE } from "./snapshot-provider";
import {
  prepareV1DataPackage as prepareLegacyV1DataPackage,
  type PreparedV1PackageSummary as LegacyPreparedV1PackageSummary,
} from "./v1-package-adapter-legacy";

export type PreparedV1PackageSummary = LegacyPreparedV1PackageSummary;

type JsonObject = Record<string, unknown>;
type GovernanceIssue = {
  sourceEntity: string;
  sourceId: string;
  code: string;
  severity: "WARNING" | "REVIEW" | "BLOCKER";
  field?: string;
  message: string;
};

function digest(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function ndjson(values: readonly JsonObject[]): string {
  return values.length === 0 ? "" : `${values.map((value) => JSON.stringify(value)).join("\n")}\n`;
}

function parseNdjson<T extends JsonObject>(body: string): T[] {
  return body.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line) as T);
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function assertLegacyMemberIdPathSafe(value: unknown): string {
  const id = String(value ?? "");
  if (!/^[\p{L}\p{N}_-]{1,120}$/u.test(id)) throw new Error("V1_PACKAGE_MEMBER_ID_PATH_UNSAFE");
  return id;
}

async function assertLegacyMemberIdsSafe(sourceRoot: string): Promise<void> {
  const raw = JSON.parse(await readFile(path.join(sourceRoot, "data/authoritative/members.full.json"), "utf8")) as { members?: Array<{ id?: unknown }> };
  if (!Array.isArray(raw.members)) throw new Error("V1_PACKAGE_MEMBERS_INVALID");
  for (const member of raw.members) assertLegacyMemberIdPathSafe(member.id);
}

function issueKey(issue: GovernanceIssue): string {
  return `${issue.sourceEntity}:${issue.sourceId}:${issue.code}:${issue.field ?? ""}`;
}

async function hardenPreparedBundle(outputRoot: string): Promise<number> {
  const organizationsPath = path.join(outputRoot, "entities", "organizations.ndjson");
  const organizations = parseNdjson<JsonObject>(await readFile(organizationsPath, "utf8"));
  for (const organization of organizations) organization.status = "INACTIVE";
  const organizationBody = ndjson(organizations);
  await writeFile(organizationsPath, organizationBody, "utf8");

  const governancePath = path.join(outputRoot, GOVERNANCE_ISSUES_FILE);
  const existingIssues = parseNdjson<GovernanceIssue>(await readFile(governancePath, "utf8"));
  const issues = new Map(existingIssues.map((issue) => [issueKey(issue), issue]));
  for (const organization of organizations) {
    const issue: GovernanceIssue = {
      sourceEntity: "ORGANIZATION",
      sourceId: String(organization.sourceId),
      code: "ORGANIZATION_INFERRED_REVIEW_REQUIRED",
      severity: "REVIEW",
      field: "status",
      message: "组织由 V1 单位/分类证据推断，仅生成 INACTIVE 候选，未经治理确认不得创建正式组织。",
    };
    issues.set(issueKey(issue), issue);
  }
  const sortedIssues = [...issues.values()].sort((left, right) => issueKey(left).localeCompare(issueKey(right)));
  const governanceBody = ndjson(sortedIssues as unknown as JsonObject[]);
  await writeFile(governancePath, governanceBody, "utf8");

  const attachmentManifestPath = path.join(outputRoot, "attachments", "manifest.ndjson");
  const attachmentRows = parseNdjson<JsonObject>(await readFile(attachmentManifestPath, "utf8"));
  const blobRoot = path.join(outputRoot, "attachments", "blobs");
  for (const row of attachmentRows) {
    const oldRelative = String(row.relativePath);
    const extension = path.extname(String(row.originalFilename || oldRelative));
    const newRelative = privateAttachmentRelativePath(String(row.sourceAttachmentId), extension);
    const oldDestination = resolvePrivateAttachmentDestination(blobRoot, oldRelative.replaceAll("\\", "/"));
    const newDestination = resolvePrivateAttachmentDestination(blobRoot, newRelative);
    if (oldDestination !== newDestination) await rename(oldDestination, newDestination);
    row.relativePath = newRelative;
  }
  attachmentRows.sort((left, right) => String(left.sourceAttachmentId).localeCompare(String(right.sourceAttachmentId)));
  const attachmentBody = ndjson(attachmentRows);
  await writeFile(attachmentManifestPath, attachmentBody, "utf8");

  const snapshotPath = path.join(outputRoot, "snapshot.json");
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8")) as JsonObject & {
    files: Record<string, { count: number; sha256: string }>;
  };
  snapshot.schemaVersion = "v1-package-reference-1";
  snapshot.snapshotKind = "SAMPLE";
  snapshot.sourceAdapter = "V1_REFERENCE_PACKAGE";
  snapshot.sourceClassification = "REFERENCE_EXPORT_NOT_FINAL";
  snapshot.applyEligible = false;
  snapshot.fullRehearsalEligible = false;
  snapshot.files["entities/organizations.ndjson"] = { count: organizations.length, sha256: digest(organizationBody) };
  snapshot.files["attachments/manifest.ndjson"] = { count: attachmentRows.length, sha256: digest(attachmentBody) };
  snapshot.files[GOVERNANCE_ISSUES_FILE] = { count: sortedIssues.length, sha256: digest(governanceBody) };
  snapshot.governanceIssues = { path: GOVERNANCE_ISSUES_FILE, ...snapshot.files[GOVERNANCE_ISSUES_FILE] };
  snapshot.files = Object.fromEntries(Object.entries(snapshot.files).sort(([left], [right]) => left.localeCompare(right)));
  await writeJson(snapshotPath, snapshot);

  const lineagePath = path.join(outputRoot, "governance", "package-lineage.json");
  const lineage = JSON.parse(await readFile(lineagePath, "utf8")) as JsonObject;
  await writeJson(lineagePath, {
    ...lineage,
    sourceAdapter: "V1_REFERENCE_PACKAGE",
    sourceClassification: "REFERENCE_EXPORT_NOT_FINAL",
    applyEligible: false,
    fullRehearsalEligible: false,
    authoritativeManifest: "snapshot.json",
  });
  return sortedIssues.length;
}

export async function prepareV1DataPackage(input: { sourceRoot: string; outputRoot: string }): Promise<PreparedV1PackageSummary> {
  await assertPrivateMigrationOutput(input.outputRoot);
  await assertLegacyMemberIdsSafe(input.sourceRoot);
  const prepared = await prepareLegacyV1DataPackage(input);
  const manualReviewCount = await hardenPreparedBundle(prepared.outputRoot);
  return { ...prepared, sourceClassification: "REFERENCE_EXPORT_NOT_FINAL", manualReviewCount };
}
