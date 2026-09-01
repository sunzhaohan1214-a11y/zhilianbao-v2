import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import {
  attachmentManifestRecordSchema,
  migrationSourceIssueSchema,
  snapshotManifestSchema,
  validateLegacyPayload,
  type LegacyAttachmentManifestRecord,
  type SnapshotManifest,
} from "./source-contract";
import { canonicalJson, sourceFingerprint } from "./fingerprint";
import { LEGACY_ENTITY_TYPES, type LegacyEntityType, type LegacyRecord, type MigrationPreviewIssue } from "./types";

const ENTITY_FILES: Record<LegacyEntityType, string> = {
  ORGANIZATION: "entities/organizations.ndjson", PERSON: "entities/persons.ndjson", ENTERPRISE: "entities/enterprises.ndjson",
  TALENT: "entities/talents.ndjson", POLICY: "entities/policies.ndjson", DEMAND: "entities/demands.ndjson",
  PRESENCE: "entities/presence.ndjson", TRIP: "entities/trips.ndjson", VISIT: "entities/visits.ndjson",
  REIMBURSEMENT: "entities/reimbursements.ndjson", HELP: "entities/helps.ndjson", ANNOUNCEMENT: "entities/announcements.ndjson",
  ROLE: "entities/roles.ndjson",
};

export const GOVERNANCE_ISSUES_FILE = "governance/manual-review.ndjson";

export interface LegacySourceProvider {
  describeSnapshot(): Promise<{ manifest: SnapshotManifest; manifestSha256: string }>;
  list(entityType: LegacyEntityType): AsyncGenerator<{ record?: LegacyRecord; issues: MigrationPreviewIssue[] }>;
  listAttachments(): AsyncGenerator<{ record?: LegacyAttachmentManifestRecord; issues: MigrationPreviewIssue[] }>;
  listIssues?(): AsyncGenerator<MigrationPreviewIssue>;
  getAttachment(record: LegacyAttachmentManifestRecord): Promise<Buffer>;
}

function digest(value: Buffer | string): string { return createHash("sha256").update(value).digest("hex"); }

function issueKey(issue: MigrationPreviewIssue): string {
  return `${issue.sourceEntity}:${issue.sourceId}`;
}

export class SnapshotDirectoryLegacySourceProvider implements LegacySourceProvider {
  private rootReal?: string;
  private descriptionPromise?: Promise<{ manifest: SnapshotManifest; manifestSha256: string }>;
  private governanceIssuesPromise?: Promise<MigrationPreviewIssue[]>;

  constructor(readonly root: string) {}

  private async safePath(relativePath: string, mustExist = true): Promise<string> {
    if (!relativePath || path.isAbsolute(relativePath) || relativePath.split(/[\\/]+/).includes("..")) throw new Error("MIGRATION_SOURCE_PATH_TRAVERSAL");
    const rootReal = this.rootReal ??= await realpath(this.root);
    const candidate = path.resolve(rootReal, relativePath);
    const prefix = rootReal.endsWith(path.sep) ? rootReal : `${rootReal}${path.sep}`;
    if (!candidate.startsWith(prefix)) throw new Error("MIGRATION_SOURCE_PATH_TRAVERSAL");
    if (!mustExist) return candidate;
    const stat = await lstat(candidate);
    if (stat.isSymbolicLink() || stat.isDirectory() && (stat.mode & 0o120000) === 0o120000) throw new Error("MIGRATION_SOURCE_SYMLINK_REJECTED");
    const candidateReal = await realpath(candidate);
    if (!candidateReal.startsWith(prefix)) throw new Error("MIGRATION_SOURCE_SYMLINK_ESCAPE");
    return candidateReal;
  }

  private async loadDescription() {
    const manifestPath = await this.safePath("snapshot.json");
    const manifest = snapshotManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
    for (const [relativePath, expected] of Object.entries(manifest.files)) {
      const filePath = await this.safePath(relativePath);
      const buffer = await readFile(filePath);
      if (digest(buffer) !== expected.sha256) throw new Error(`MIGRATION_SOURCE_MANIFEST_HASH_MISMATCH:${relativePath}`);
      const count = buffer.toString("utf8").split(/\r?\n/).filter((line) => line.trim()).length;
      if (count !== expected.count) throw new Error(`MIGRATION_SOURCE_MANIFEST_COUNT_MISMATCH:${relativePath}`);
    }
    for (const entityType of LEGACY_ENTITY_TYPES) {
      const expected = manifest.entities[entityType] ?? 0;
      const actual = manifest.files[ENTITY_FILES[entityType]]?.count ?? 0;
      if (actual !== expected) throw new Error(`MIGRATION_SOURCE_ENTITY_COUNT_MISMATCH:${entityType}`);
    }
    const manifestSha256 = sourceFingerprint({ ...manifest, files: Object.fromEntries(Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b))) });
    return { manifest, manifestSha256 };
  }

  async describeSnapshot() {
    return this.descriptionPromise ??= this.loadDescription();
  }

  private async *lines(relativePath: string): AsyncGenerator<{ line: string; lineNumber: number }> {
    const filePath = await this.safePath(relativePath);
    const stream = createReadStream(filePath, { encoding: "utf8" });
    const reader = createInterface({ input: stream, crlfDelay: Infinity });
    let lineNumber = 0;
    for await (const line of reader) {
      lineNumber += 1;
      if (line.trim()) yield { line, lineNumber };
    }
  }

  private async loadGovernanceIssues(): Promise<MigrationPreviewIssue[]> {
    const { manifest } = await this.describeSnapshot();
    if (!manifest.governanceIssues) return [];
    const issues: MigrationPreviewIssue[] = [];
    for await (const { line, lineNumber } of this.lines(manifest.governanceIssues.path)) {
      let raw: unknown;
      try { raw = JSON.parse(line); }
      catch { throw new Error(`MIGRATION_SOURCE_GOVERNANCE_ISSUE_INVALID:LINE-${lineNumber}`); }
      const parsed = migrationSourceIssueSchema.safeParse(raw);
      if (!parsed.success) throw new Error(`MIGRATION_SOURCE_GOVERNANCE_ISSUE_INVALID:LINE-${lineNumber}`);
      issues.push(parsed.data);
    }
    if (issues.length !== manifest.governanceIssues.count) throw new Error("MIGRATION_SOURCE_GOVERNANCE_ISSUE_COUNT_MISMATCH");
    return issues;
  }

  private async governanceIssues(): Promise<MigrationPreviewIssue[]> {
    return this.governanceIssuesPromise ??= this.loadGovernanceIssues();
  }

  async *listIssues(): AsyncGenerator<MigrationPreviewIssue> {
    for (const issue of await this.governanceIssues()) yield issue;
  }

  private async issuesFor(sourceEntity: MigrationPreviewIssue["sourceEntity"], ...sourceIds: string[]): Promise<MigrationPreviewIssue[]> {
    const keys = new Set(sourceIds.map((sourceIdValue) => `${sourceEntity}:${sourceIdValue}`));
    return (await this.governanceIssues()).filter((issue) => keys.has(issueKey(issue)));
  }

  async *list(entityType: LegacyEntityType): AsyncGenerator<{ record?: LegacyRecord; issues: MigrationPreviewIssue[] }> {
    const seen = new Set<string>();
    for await (const { line, lineNumber } of this.lines(ENTITY_FILES[entityType])) {
      let raw: unknown;
      try { raw = JSON.parse(line); }
      catch {
        yield { issues: [{ sourceEntity: entityType, sourceId: `LINE-${lineNumber}`, code: "MIGRATION_SOURCE_INVALID", severity: "BLOCKER" as const, message: "NDJSON 不是合法 JSON" }] };
        continue;
      }
      const validated = validateLegacyPayload(entityType, raw);
      if (validated.record && seen.has(validated.record.sourceId)) {
        yield { issues: [{ sourceEntity: entityType, sourceId: validated.record.sourceId, code: "MIGRATION_DUPLICATE_SOURCE_ID", severity: "BLOCKER", message: "同一实体文件包含重复 sourceId" }] };
        continue;
      }
      if (!validated.record) {
        yield validated;
        continue;
      }
      seen.add(validated.record.sourceId);
      const governance = await this.issuesFor(entityType, validated.record.sourceId);
      const issues = [...validated.issues, ...governance];
      if (issues.some((issue) => issue.severity === "BLOCKER" || issue.severity === "REVIEW")) yield { issues };
      else yield { record: validated.record, issues };
    }
  }

  async *listAttachments() {
    const relativePath = "attachments/manifest.ndjson";
    for await (const { line, lineNumber } of this.lines(relativePath)) {
      let raw: unknown;
      try { raw = JSON.parse(line); }
      catch {
        yield { issues: [{ sourceEntity: "ATTACHMENT" as const, sourceId: `LINE-${lineNumber}`, code: "MIGRATION_SOURCE_INVALID", severity: "BLOCKER" as const, message: "附件 manifest 不是合法 JSON" }] };
        continue;
      }
      const parsed = attachmentManifestRecordSchema.safeParse(raw);
      if (!parsed.success) {
        yield { issues: parsed.error.issues.map((validationIssue) => ({ sourceEntity: "ATTACHMENT" as const, sourceId: `LINE-${lineNumber}`, code: "MIGRATION_SOURCE_INVALID", severity: "BLOCKER" as const, field: validationIssue.path.join("."), message: validationIssue.message })) };
        continue;
      }
      const governance = await this.issuesFor("ATTACHMENT", parsed.data.sourceAttachmentId, parsed.data.sourceId);
      if (governance.some((issue) => issue.severity === "BLOCKER" || issue.severity === "REVIEW")) yield { issues: governance };
      else yield { record: parsed.data, issues: governance };
    }
  }

  async getAttachment(record: LegacyAttachmentManifestRecord): Promise<Buffer> {
    if (path.isAbsolute(record.relativePath) || record.relativePath.split(/[\\/]+/).includes("..")) throw new Error("MIGRATION_SOURCE_PATH_TRAVERSAL");
    const relative = path.posix.join("attachments/blobs", record.relativePath.replaceAll("\\", "/"));
    const filePath = await this.safePath(relative);
    return readFile(filePath);
  }
}

export { ENTITY_FILES, canonicalJson };
