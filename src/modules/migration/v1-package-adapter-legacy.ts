import { createHash } from "node:crypto";
import { chmod, copyFile, lstat, mkdir, readFile, realpath, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ENTITY_FILES } from "./snapshot-provider";
import { resolveSafeMigrationOutputPath } from "./private-output-guard";
import { LEGACY_ENTITY_TYPES, type LegacyEntityType } from "./types";

const sha256Pattern = /^[a-f0-9]{64}$/;
const privateDirectoryMode = 0o700;
const privateFileMode = 0o600;
const packageManifestSchema = z.object({
  packageName: z.string().trim().min(1).max(191),
  fileCount: z.number().int().nonnegative(),
  files: z.array(z.object({
    path: z.string().trim().min(1).max(500),
    bytes: z.number().int().nonnegative(),
    sha256: z.string().regex(sha256Pattern),
  }).strict()),
}).strict();

const membersFileSchema = z.object({
  batches: z.array(z.object({
    id: z.string().trim().min(1),
    period: z.string().trim().min(1),
    memberCount: z.number().int().nonnegative(),
  }).passthrough()),
  members: z.array(z.object({
    id: z.union([z.string(), z.number()]),
    batch: z.string().trim().min(1),
    name: z.string().trim().min(1),
    contact: z.union([z.string(), z.number(), z.null()]).optional(),
    unit: z.union([z.string(), z.null()]).optional(),
    position: z.union([z.string(), z.null()]).optional(),
    photo: z.union([z.string(), z.null()]).optional(),
  }).passthrough()),
}).strict();

const contactsFileSchema = z.object({
  source: z.unknown().optional(),
  updatedAt: z.string().optional(),
  categories: z.array(z.object({ key: z.string(), label: z.string() }).passthrough()),
  contacts: z.array(z.object({
    id: z.union([z.string(), z.number()]),
    category: z.string(),
    unit: z.union([z.string(), z.null()]).optional(),
    name: z.string().trim().min(1),
    title: z.union([z.string(), z.null()]).optional(),
    phone: z.union([z.string(), z.number(), z.null()]).optional(),
  }).passthrough()),
}).passthrough();

const institutionLocationsFileSchema = z.object({
  metadata: z.object({
    license: z.string().trim().min(1),
    attribution: z.string().trim().min(1),
    purpose: z.string().trim().min(1),
  }).strict(),
  locations: z.array(z.object({
    name: z.string().trim().min(1),
    aliases: z.array(z.string().trim().min(1)).default([]),
    province: z.string().trim().min(1),
    city: z.string().trim().min(1),
    lng: z.number().min(-180).max(180),
    lat: z.number().min(-90).max(90),
  }).strict()),
}).strict();

const qualityReportSchema = z.object({
  generatedAt: z.iso.datetime({ offset: true }),
  timezone: z.string().optional(),
  counts: z.record(z.string(), z.unknown()),
  geoJson: z.array(z.object({
    file: z.string(),
    type: z.string().optional(),
    featureCount: z.number().int().nonnegative(),
    validFeatureCollection: z.boolean(),
  }).passthrough()),
  warnings: z.array(z.string()).default([]),
  exclusions: z.unknown().optional(),
}).passthrough();

type JsonObject = Record<string, unknown>;
type ManualReview = {
  sourceEntity: string;
  sourceId: string;
  code: string;
  severity: "WARNING" | "REVIEW" | "BLOCKER";
  field?: string;
  message: string;
};

export type PreparedV1PackageSummary = {
  outputRoot: string;
  packageName: string;
  snapshotId: string;
  sourceClassification: "REFERENCE_EXPORT_NOT_FINAL";
  checksumVerifiedFileCount: number;
  entities: Record<LegacyEntityType, number>;
  attachmentCount: number;
  manualReviewCount: number;
  mapCandidateCount: number;
  dispatchLocationCandidateCount: number;
  dispatchLocationMatchPreviewCount: number;
};

function digest(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedRelativePath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  if (!normalized || path.posix.isAbsolute(normalized) || normalized.split("/").includes("..")) {
    throw new Error("V1_PACKAGE_PATH_INVALID");
  }
  return normalized;
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function listRegularFiles(root: string, current = root): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink()) throw new Error("V1_PACKAGE_SYMLINK_REJECTED");
    if (entry.isDirectory()) result.push(...await listRegularFiles(root, absolute));
    else if (entry.isFile()) result.push(path.relative(root, absolute).replaceAll("\\", "/"));
    else throw new Error("V1_PACKAGE_NON_REGULAR_FILE_REJECTED");
  }
  return result.sort((left, right) => left.localeCompare(right));
}

async function verifyPackage(root: string) {
  const checksumLines = (await readFile(path.join(root, "checksums.sha256"), "utf8"))
    .split(/\r?\n/).filter((line) => line.trim());
  const expected = new Map<string, string>();
  for (const line of checksumLines) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!match) throw new Error("V1_PACKAGE_CHECKSUM_FORMAT_INVALID");
    const relative = normalizedRelativePath(match[2]);
    if (expected.has(relative)) throw new Error("V1_PACKAGE_CHECKSUM_DUPLICATE_PATH");
    expected.set(relative, match[1]);
  }
  const actualFiles = await listRegularFiles(root);
  const expectedFiles = actualFiles.filter((value) => value !== "checksums.sha256");
  if (expected.size !== expectedFiles.length || expectedFiles.some((value) => !expected.has(value))) {
    throw new Error("V1_PACKAGE_CHECKSUM_COVERAGE_MISMATCH");
  }
  for (const [relative, expectedHash] of expected) {
    const body = await readFile(path.join(root, relative));
    if (digest(body) !== expectedHash) throw new Error(`V1_PACKAGE_CHECKSUM_MISMATCH:${relative}`);
  }

  const manifestBody = await readFile(path.join(root, "MANIFEST.json"));
  const manifest = packageManifestSchema.parse(JSON.parse(manifestBody.toString("utf8")));
  if (manifest.fileCount !== manifest.files.length) throw new Error("V1_PACKAGE_MANIFEST_COUNT_MISMATCH");
  const excluded = new Set(["checksums.sha256", "MANIFEST.json", "MANIFEST.csv"]);
  const payloadFiles = actualFiles.filter((value) => !excluded.has(value));
  const manifestPaths = new Set<string>();
  for (const value of manifest.files) {
    const relative = normalizedRelativePath(value.path);
    if (manifestPaths.has(relative)) throw new Error("V1_PACKAGE_MANIFEST_DUPLICATE_PATH");
    manifestPaths.add(relative);
    const body = await readFile(path.join(root, relative));
    if (body.byteLength !== value.bytes || digest(body) !== value.sha256) {
      throw new Error(`V1_PACKAGE_MANIFEST_MISMATCH:${relative}`);
    }
  }
  if (manifestPaths.size !== payloadFiles.length || payloadFiles.some((value) => !manifestPaths.has(value))) {
    throw new Error("V1_PACKAGE_MANIFEST_COVERAGE_MISMATCH");
  }
  return { manifest, manifestSha256: digest(manifestBody), checksumVerifiedFileCount: expected.size };
}

function text(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(text).filter((item): item is string => Boolean(item));
    return parts.length > 0 ? parts.join("；") : undefined;
  }
  return undefined;
}

function stringArray(...values: unknown[]): string[] {
  return [...new Set(values.flatMap((value) => Array.isArray(value) ? value : value === undefined || value === null ? [] : [value])
    .map(text).filter((item): item is string => Boolean(item)))].sort((left, right) => left.localeCompare(right));
}

function finiteCoordinate(value: unknown, minimum: number, maximum: number): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : undefined;
}

function sourceUpdatedAt(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const local = /^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})$/.exec(raw);
  if (local) return `${local[1]}-${local[2].padStart(2, "0")}-${local[3].padStart(2, "0")}T${local[4].padStart(2, "0")}:${local[5]}:${local[6]}+08:00`;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString();
}

function organizationSourceId(name: string): string {
  return `ORG-${digest(name.trim()).slice(0, 24).toUpperCase()}`;
}

function parseChinesePeriod(value: string): { startDate: string; endDate: string } | undefined {
  const match = /^(\d{4})年(\d{1,2})月-(\d{4})年(\d{1,2})月$/.exec(value.trim());
  if (!match) return undefined;
  const startYear = Number(match[1]);
  const startMonth = Number(match[2]);
  const endYear = Number(match[3]);
  const endMonth = Number(match[4]);
  if (startMonth < 1 || startMonth > 12 || endMonth < 1 || endMonth > 12) return undefined;
  const endDay = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();
  return {
    startDate: `${startYear}-${String(startMonth).padStart(2, "0")}-01`,
    endDate: `${endYear}-${String(endMonth).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`,
  };
}

function shanghaiDateOnly(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function memberKind(period: { startDate: string; endDate: string } | undefined, snapshotAt: string) {
  if (!period) return "ALUMNI_HISTORICAL" as const;
  const current = shanghaiDateOnly(snapshotAt);
  if (period.startDate > current) return "FUTURE_MEMBER_CANDIDATE" as const;
  if (period.endDate >= current) return "CURRENT" as const;
  return "ALUMNI_HISTORICAL" as const;
}

function ndjson(values: readonly JsonObject[]): string {
  return values.map((value) => JSON.stringify(value)).join("\n") + (values.length > 0 ? "\n" : "");
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: privateFileMode });
}

function describeCoordinates(value: unknown, state: { minLng: number; maxLng: number; minLat: number; maxLat: number; valid: boolean }) {
  if (!Array.isArray(value)) { state.valid = false; return; }
  if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
    const [lng, lat] = value as number[];
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) { state.valid = false; return; }
    state.minLng = Math.min(state.minLng, lng); state.maxLng = Math.max(state.maxLng, lng);
    state.minLat = Math.min(state.minLat, lat); state.maxLat = Math.max(state.maxLat, lat);
    return;
  }
  for (const child of value) describeCoordinates(child, state);
}

async function buildMapCatalog(root: string, manifestHashes: ReadonlyMap<string, string>) {
  const files = (await listRegularFiles(path.join(root, "maps", "geojson"))).map((relative) => `maps/geojson/${relative}`);
  const candidates = [];
  for (const relative of files) {
    const parsed = await readJson(path.join(root, relative)) as JsonObject;
    const features = Array.isArray(parsed.features) ? parsed.features as JsonObject[] : [];
    const geometryTypes = new Set<string>();
    const state = { minLng: Infinity, maxLng: -Infinity, minLat: Infinity, maxLat: -Infinity, valid: parsed.type === "FeatureCollection" };
    for (const feature of features) {
      const geometry = feature.geometry as JsonObject | undefined;
      if (typeof geometry?.type === "string") geometryTypes.add(geometry.type);
      describeCoordinates(geometry?.coordinates, state);
    }
    const featureNames = [...new Set(features.flatMap((feature) => {
      const properties = feature.properties as JsonObject | undefined;
      const name = text(properties?.name);
      return name ? [name] : [];
    }))].sort((left, right) => left.localeCompare(right));
    const operationalCandidate = /baoying_(?:county|towns)\.geojson\.json$/.test(relative);
    candidates.push({
      path: relative,
      sha256: manifestHashes.get(relative),
      featureCount: features.length,
      featureNames,
      geometryTypes: [...geometryTypes].sort(),
      coordinateRangeValid: state.valid && Number.isFinite(state.minLng),
      bbox: Number.isFinite(state.minLng) ? [state.minLng, state.minLat, state.maxLng, state.maxLat] : null,
      disposition: operationalCandidate ? "REVIEW_REQUIRED" : "REFERENCE_ONLY",
      reasons: operationalCandidate
        ? ["SOURCE_LICENSE_UNVERIFIED", "COORDINATE_SYSTEM_UNVERIFIED", "BOUNDARY_VERSION_UNVERIFIED", "PRIVATE_VERSIONED_IMPORT_REQUIRED"]
        : ["OUTSIDE_INITIAL_BAOYING_OPERATIONAL_SCOPE", "DO_NOT_BUNDLE_IN_FRONTEND"],
    });
  }
  return candidates;
}

function buildDispatchLocationCandidates(input: z.infer<typeof institutionLocationsFileSchema>) {
  const seenNames = new Set<string>();
  const seenLookupKeys = new Set<string>();
  return input.locations.map((location) => {
    const nameKey = location.name.trim().toLocaleLowerCase("zh-CN");
    if (seenNames.has(nameKey)) throw new Error("V1_PACKAGE_DISPATCH_LOCATION_DUPLICATE_NAME");
    seenNames.add(nameKey);
    const aliases = [...new Set(location.aliases.map((alias) => alias.trim()).filter((alias) => alias && alias !== location.name))]
      .sort((left, right) => left.localeCompare(right));
    for (const lookup of [location.name, ...aliases]) {
      const key = lookup.toLocaleLowerCase("zh-CN");
      if (seenLookupKeys.has(key)) throw new Error("V1_PACKAGE_DISPATCH_LOCATION_AMBIGUOUS_ALIAS");
      seenLookupKeys.add(key);
    }
    return {
      sourceId: `DISPATCH-LOCATION-${digest(location.name).slice(0, 24).toUpperCase()}`,
      name: location.name,
      aliases,
      province: location.province,
      city: location.city,
      latitude: location.lat,
      longitude: location.lng,
      intendedUse: "DISPATCH_ORGANIZATION_LOCATION",
      memberMapPath: ["中国", location.province, location.city, location.name],
      disposition: "REVIEW_REQUIRED",
      reasons: [
        "DISPATCH_ORGANIZATION_MATCH_REQUIRED",
        "COORDINATE_SYSTEM_UNVERIFIED",
        "ADMIN_CONFIRMATION_REQUIRED",
        "NEVER_INTERPRET_AS_MEMBER_LOCATION",
      ],
    };
  }).sort((left, right) => left.sourceId.localeCompare(right.sourceId));
}

function normalizedOrganizationLookup(value: string): string {
  return value.trim().toLocaleLowerCase("zh-CN").replace(/[\s（）()·・]/g, "");
}

function buildDispatchLocationMatchPreview(organizations: readonly JsonObject[], locations: ReturnType<typeof buildDispatchLocationCandidates>) {
  return organizations.filter((organization) => organization.organizationType === "DISPATCH_UNIT").map((organization) => {
    const organizationName = String(organization.name);
    const organizationKey = normalizedOrganizationLookup(organizationName);
    const candidates = locations.flatMap((location) => {
      const lookupNames = [location.name, ...location.aliases];
      const exact = lookupNames.find((value) => normalizedOrganizationLookup(value) === organizationKey);
      const contained = exact ? undefined : lookupNames.find((value) => {
        const key = normalizedOrganizationLookup(value);
        return key.length >= 4 && (organizationKey.includes(key) || key.includes(organizationKey));
      });
      const matchedBy = exact ?? contained;
      return matchedBy ? [{
        locationSourceId: location.sourceId,
        locationName: location.name,
        province: location.province,
        city: location.city,
        latitude: location.latitude,
        longitude: location.longitude,
        matchBasis: exact ? "EXACT_NAME_OR_ALIAS" : "UNIQUE_NAME_CONTAINMENT_CANDIDATE",
        matchedBy,
      }] : [];
    });
    return {
      organizationSourceId: String(organization.sourceId),
      organizationName,
      candidateCount: candidates.length,
      suggestedLocationSourceId: candidates.length === 1 ? candidates[0].locationSourceId : null,
      disposition: "REVIEW_REQUIRED",
      reviewCode: candidates.length === 0 ? "DISPATCH_LOCATION_CANDIDATE_MISSING" : candidates.length === 1 ? "DISPATCH_LOCATION_MATCH_CONFIRMATION_REQUIRED" : "DISPATCH_LOCATION_MATCH_AMBIGUOUS",
      candidates,
    };
  }).sort((left, right) => left.organizationSourceId.localeCompare(right.organizationSourceId));
}

export async function prepareV1DataPackage(input: { sourceRoot: string; outputRoot: string }): Promise<PreparedV1PackageSummary> {
  const sourceRoot = await realpath(input.sourceRoot);
  const outputRoot = await resolveSafeMigrationOutputPath(input.outputRoot);
  const sourcePrefix = sourceRoot.endsWith(path.sep) ? sourceRoot : `${sourceRoot}${path.sep}`;
  const outputPrefix = outputRoot.endsWith(path.sep) ? outputRoot : `${outputRoot}${path.sep}`;
  if (outputRoot === sourceRoot || outputRoot.startsWith(sourcePrefix) || sourceRoot.startsWith(outputPrefix)) {
    throw new Error("V1_PACKAGE_OUTPUT_PATH_OVERLAP");
  }
  const verified = await verifyPackage(sourceRoot);
  const members = membersFileSchema.parse(await readJson(path.join(sourceRoot, "data/authoritative/members.full.json")));
  const contacts = contactsFileSchema.parse(await readJson(path.join(sourceRoot, "data/authoritative/contacts.full.json")));
  const institutionLocations = institutionLocationsFileSchema.parse(await readJson(path.join(sourceRoot, "data/authoritative/member-institution-locations.json")));
  const enterpriseRaw = z.array(z.record(z.string(), z.unknown())).parse(await readJson(path.join(sourceRoot, "data/authoritative/enterprises.full.json")));
  const quality = qualityReportSchema.parse(await readJson(path.join(sourceRoot, "reports/data-quality-report.json")));
  const manifestHashes = new Map(verified.manifest.files.map((value) => [value.path.replaceAll("\\", "/"), value.sha256]));
  const batchPeriods = new Map(members.batches.map((batch) => [batch.id, parseChinesePeriod(batch.period)]));
  const review: ManualReview[] = [];

  const organizationEvidence = new Map<string, Set<"TOWNSHIP" | "DEPARTMENT" | "DISPATCH_UNIT">>();
  for (const member of members.members) {
    const unit = text(member.unit);
    if (unit) (organizationEvidence.get(unit) ?? organizationEvidence.set(unit, new Set()).get(unit)!).add("DISPATCH_UNIT");
  }
  const departmentCategories = new Set(["organization", "technology", "industry", "hr"]);
  for (const contact of contacts.contacts) {
    const unit = text(contact.unit);
    if (!unit) continue;
    const type = contact.category === "town" ? "TOWNSHIP" : departmentCategories.has(contact.category) ? "DEPARTMENT" : "DISPATCH_UNIT";
    (organizationEvidence.get(unit) ?? organizationEvidence.set(unit, new Set()).get(unit)!).add(type);
  }
  const organizationRank = { TOWNSHIP: 3, DEPARTMENT: 2, DISPATCH_UNIT: 1 } as const;
  const organizations: JsonObject[] = [...organizationEvidence.entries()].map(([name, evidence]) => {
    const ordered = [...evidence].sort((left, right) => organizationRank[right] - organizationRank[left]);
    const sourceId = organizationSourceId(name);
    if (ordered.length > 1) review.push({ sourceEntity: "ORGANIZATION", sourceId, code: "ORGANIZATION_TYPE_EVIDENCE_CONFLICT", severity: "REVIEW", field: "organizationType", message: "同一单位在 V1 中存在多种类型证据，已按保守优先级生成候选。" });
    return { sourceId, name, organizationType: ordered[0], status: "ACTIVE" };
  }).sort((left, right) => String(left.sourceId).localeCompare(String(right.sourceId)));

  const people: JsonObject[] = [];
  for (const member of members.members) {
    const sourceId = `MEMBER-${String(member.id)}`;
    const period = batchPeriods.get(member.batch);
    const kind = memberKind(period, quality.generatedAt);
    people.push({
      sourceId,
      name: member.name,
      ...(text(member.contact) ? { phone: text(member.contact) } : {}),
      memberKind: kind,
      currentEmploymentConfirmed: false,
      accountEligible: false,
      batchName: member.batch,
      ...(period ? { startDate: period.startDate, endDate: period.endDate } : {}),
    });
    if (!period) review.push({ sourceEntity: "PERSON", sourceId, code: "MEMBER_BATCH_PERIOD_INVALID", severity: "BLOCKER", field: "batch", message: "V1 批次期间无法稳定解析。" });
    if (kind === "CURRENT") review.push({ sourceEntity: "PERSON", sourceId, code: "CURRENT_EMPLOYMENT_CONFIRMATION_REQUIRED", severity: "REVIEW", field: "currentEmploymentConfirmed", message: "资料包不能证明当前在岗，不创建账号或当前批次关系。" });
    if (kind === "FUTURE_MEMBER_CANDIDATE") review.push({ sourceEntity: "PERSON", sourceId, code: "FUTURE_BATCH_NOT_ACTIVE", severity: "REVIEW", field: "batchName", message: "批次开始时间晚于资料包生成时间，仅作未来候选人员。" });
  }
  for (const contact of contacts.contacts) {
    const sourceId = `CONTACT-${String(contact.id)}`;
    people.push({
      sourceId,
      name: contact.name,
      ...(text(contact.phone) ? { phone: text(contact.phone) } : {}),
      memberKind: "INTERNAL_STAFF",
      currentEmploymentConfirmed: false,
      accountEligible: false,
    });
    review.push({ sourceEntity: "PERSON", sourceId, code: "CONTACT_APPOINTMENT_AND_ACCOUNT_REVIEW_REQUIRED", severity: "REVIEW", field: "currentEmploymentConfirmed", message: "V1 通讯录不代表 V2 在岗、任职、账号或角色授权，需人工确认。" });
  }
  people.sort((left, right) => String(left.sourceId).localeCompare(String(right.sourceId)));

  const enterprises: JsonObject[] = enterpriseRaw.map((enterprise) => {
    const sourceId = `ENTERPRISE-${String(enterprise.id ?? "UNKNOWN")}`;
    const latitude = finiteCoordinate(enterprise.lat, -90, 90);
    const longitude = finiteCoordinate(enterprise.lng, -180, 180);
    const tagNames = stringArray(enterprise.industries, enterprise.tags, enterprise.demandTags);
    const updatedAt = sourceUpdatedAt(enterprise.updatedAt);
    const value: JsonObject = {
      sourceId,
      ...(updatedAt ? { sourceUpdatedAt: updatedAt } : {}),
      name: text(enterprise.name) ?? "",
      responsibleAreaName: text(enterprise.town) ?? "",
      address: text(enterprise.address) ?? "",
      ...(text(enterprise.uscc) ? { creditCode: text(enterprise.uscc) } : {}),
      ...(text(enterprise.legalPerson) ? { legalRepresentative: text(enterprise.legalPerson) } : {}),
      mainProducts: text(enterprise.mainProducts) ?? "",
      ...(text(enterprise.qualification) ? { qualificationsHonors: text(enterprise.qualification) } : {}),
      ...(latitude !== undefined ? { latitude } : {}),
      ...(longitude !== undefined ? { longitude } : {}),
      ...(text(enterprise.phone) ? { contactPhone: text(enterprise.phone) } : {}),
      primaryContactConfirmed: false,
      ...(tagNames.length > 0 ? { legacyTagNames: tagNames } : {}),
    };
    if (!value.name || !value.responsibleAreaName || !value.address || !value.mainProducts) {
      review.push({ sourceEntity: "ENTERPRISE", sourceId, code: "ENTERPRISE_REQUIRED_FIELD_MISSING", severity: "BLOCKER", message: "V1 企业缺少 V2 建档所需的名称、负责区域、地址或主营产品。" });
    }
    if (text(enterprise.phone)) review.push({ sourceEntity: "ENTERPRISE", sourceId, code: "ENTERPRISE_CONTACT_NAME_REQUIRED", severity: "REVIEW", field: "contactPhone", message: "V1 只有企业电话而无可证明的联系人姓名，不自动创建主要联系人。" });
    if (latitude !== undefined || longitude !== undefined) review.push({ sourceEntity: "ENTERPRISE", sourceId, code: "ENTERPRISE_COORDINATE_SEPARATE_GOVERNANCE", severity: "WARNING", field: "latitude", message: "坐标只作展示候选，不参与正式属地判定，且需单独地图治理后写入。" });
    if (tagNames.length > 0) review.push({ sourceEntity: "ENTERPRISE", sourceId, code: "ENTERPRISE_TAG_MAPPING_REQUIRED", severity: "WARNING", field: "legacyTagNames", message: "V1 标签已保留为候选名称，需映射到 V2 受治理标签后才能生效。" });
    return value;
  }).sort((left, right) => String(left.sourceId).localeCompare(String(right.sourceId)));

  await mkdir(outputRoot, { mode: privateDirectoryMode });
  await mkdir(path.join(outputRoot, "entities"), { mode: privateDirectoryMode });
  await mkdir(path.join(outputRoot, "attachments", "blobs", "members"), { recursive: true, mode: privateDirectoryMode });
  await mkdir(path.join(outputRoot, "governance"), { mode: privateDirectoryMode });

  const entityValues = Object.fromEntries(LEGACY_ENTITY_TYPES.map((entityType) => [entityType, [] as JsonObject[]])) as Record<LegacyEntityType, JsonObject[]>;
  entityValues.ORGANIZATION = organizations;
  entityValues.PERSON = people;
  entityValues.ENTERPRISE = enterprises;
  const fileManifest: Record<string, { count: number; sha256: string }> = {};
  for (const entityType of LEGACY_ENTITY_TYPES) {
    const body = ndjson(entityValues[entityType]);
    const relative = ENTITY_FILES[entityType];
    await writeFile(path.join(outputRoot, relative), body, { encoding: "utf8", mode: privateFileMode });
    fileManifest[relative] = { count: entityValues[entityType].length, sha256: digest(body) };
  }

  const attachmentRows: JsonObject[] = [];
  const referencedMedia = new Set<string>();
  for (const member of members.members) {
    const photo = text(member.photo);
    if (!photo) continue;
    const sourceRelative = normalizedRelativePath(photo.replace(/^\/?members\//, "media/member-photos/"));
    const sourceAbsolute = path.join(sourceRoot, sourceRelative);
    const sourceBody = await readFile(sourceAbsolute);
    const extension = path.extname(sourceRelative).toLowerCase();
    const sourceId = `MEMBER-${String(member.id)}`;
    const targetRelative = `members/${sourceId}${extension}`;
    const targetAbsolute = path.join(outputRoot, "attachments", "blobs", targetRelative);
    await copyFile(sourceAbsolute, targetAbsolute);
    await chmod(targetAbsolute, privateFileMode);
    referencedMedia.add(sourceRelative);
    attachmentRows.push({
      sourceAttachmentId: `MEMBER-PHOTO-${String(member.id)}`,
      sourceEntity: "PERSON",
      sourceId,
      relativePath: targetRelative,
      sha256: digest(sourceBody),
      size: sourceBody.byteLength,
      originalFilename: path.basename(sourceRelative),
      declaredMimeType: extension === ".png" ? "image/png" : "image/jpeg",
    });
  }
  attachmentRows.sort((left, right) => String(left.sourceAttachmentId).localeCompare(String(right.sourceAttachmentId)));
  const attachmentBody = ndjson(attachmentRows);
  await writeFile(path.join(outputRoot, "attachments", "manifest.ndjson"), attachmentBody, { encoding: "utf8", mode: privateFileMode });
  fileManifest["attachments/manifest.ndjson"] = { count: attachmentRows.length, sha256: digest(attachmentBody) };

  const allMedia = (await listRegularFiles(path.join(sourceRoot, "media", "member-photos"))).map((value) => `media/member-photos/${value}`);
  for (const relative of allMedia.filter((value) => !referencedMedia.has(value))) {
    review.push({ sourceEntity: "ATTACHMENT", sourceId: digest(relative).slice(0, 24), code: "UNREFERENCED_MEMBER_PHOTO", severity: "REVIEW", field: "relativePath", message: "资料包中照片没有权威成员记录引用，不自动关联。" });
  }

  const mapCandidates = await buildMapCatalog(sourceRoot, manifestHashes);
  const dispatchLocationCandidates = buildDispatchLocationCandidates(institutionLocations);
  const dispatchLocationMatchPreview = buildDispatchLocationMatchPreview(organizations, dispatchLocationCandidates);
  for (const match of dispatchLocationMatchPreview) {
    review.push({
      sourceEntity: "ORGANIZATION",
      sourceId: match.organizationSourceId,
      code: match.reviewCode,
      severity: "REVIEW",
      field: "name",
      message: match.candidateCount === 0
        ? "派出单位没有位置候选，必须保留列表并进入地图信息待完善。"
        : match.candidateCount === 1
          ? "派出单位存在唯一名称候选，但仍须管理员确认后才能写入省、市和坐标。"
          : "派出单位命中多个位置候选，必须由管理员选择，禁止自动写入。",
    });
  }
  const runtimeFiles = ["users", "enterprise_records", "workflow_records", "member_records", "policy_documents", "audit_logs"];
  const runtimeHistory = [];
  for (const name of runtimeFiles) {
    const parsed = await readJson(path.join(sourceRoot, `data/runtime-history/${name}.json`)) as JsonObject;
    runtimeHistory.push({ sourceTable: name, recordCount: Number(parsed.recordCount ?? 0), disposition: "REFERENCE_ONLY", reason: name === "users" ? "ACCOUNT_ROLE_AUTHORIZATION_NOT_TRANSFERABLE" : "RUNTIME_HISTORY_REQUIRES_DOMAIN_SPECIFIC_MAPPING" });
  }
  review.push({ sourceEntity: "SNAPSHOT", sourceId: verified.manifest.packageName, code: "NOT_FINAL_V1_PRODUCTION_SNAPSHOT", severity: "BLOCKER", message: "本包是本地参考导出，不是获授权的 V1 最终生产快照，不得用于 FULL 验收或正式切换。" });
  review.sort((left, right) => `${left.sourceEntity}:${left.sourceId}:${left.code}`.localeCompare(`${right.sourceEntity}:${right.sourceId}:${right.code}`));

  const snapshotId = `${verified.manifest.packageName}-${verified.manifestSha256.slice(0, 12)}`;
  const snapshot = {
    sourceSystem: "ZHILIANBAO_V1",
    schemaVersion: "v1-package-reference-1",
    snapshotId,
    snapshotAt: quality.generatedAt,
    exportedAt: quality.generatedAt,
    isSanitized: false,
    snapshotKind: "SAMPLE",
    mappingVersion: "v1-package-to-v2-20260831-1",
    files: Object.fromEntries(Object.entries(fileManifest).sort(([left], [right]) => left.localeCompare(right))),
    entities: Object.fromEntries(LEGACY_ENTITY_TYPES.map((entityType) => [entityType, entityValues[entityType].length])),
  };
  await writeJson(path.join(outputRoot, "snapshot.json"), snapshot);
  await writeJson(path.join(outputRoot, "migration-resolutions.json"), { version: "v1-package-reference-empty-1", resolutions: [] });
  await writeJson(path.join(outputRoot, "governance", "package-lineage.json"), {
    sourceClassification: "REFERENCE_EXPORT_NOT_FINAL",
    sourcePackage: verified.manifest.packageName,
    sourceManifestSha256: verified.manifestSha256,
    checksumVerifiedFileCount: verified.checksumVerifiedFileCount,
    sensitive: true,
    gitEligible: false,
    fullRehearsalEligible: false,
  });
  await writeFile(path.join(outputRoot, "governance", "manual-review.ndjson"), ndjson(review as unknown as JsonObject[]), { encoding: "utf8", mode: privateFileMode });
  await writeJson(path.join(outputRoot, "governance", "map-candidates.json"), {
    policy: "REVIEW_BEFORE_MAP_BOUNDARY_VERSION; NEVER_INFER_RESPONSIBLE_AREA_FROM_COORDINATES",
    candidates: mapCandidates,
    visualAssetsDisposition: "REFERENCE_ONLY",
    productDesign: {
      enterpriseMap: { scopePath: ["BAOYING_COUNTY", "RESPONSIBLE_AREA", "ENTERPRISE"], countAuthority: "ENTERPRISE_RESPONSIBLE_AREA_ID", coordinateUse: "DISPLAY_ONLY" },
      memberMap: { scopePath: ["COUNTRY", "PROVINCE", "CITY", "DISPATCH_ORGANIZATION", "PERSON"], countAuthority: "DISTINCT_PERSON_VIA_BATCH_MEMBERSHIP", coordinateUse: "DISPATCH_ORGANIZATION_DISPLAY_ONLY" },
    },
  });
  await writeJson(path.join(outputRoot, "governance", "dispatch-organization-location-candidates.json"), {
    policy: "MATCH_TO_FORMAL_DISPATCH_ORGANIZATION_BEFORE_WRITE; NEVER_INTERPRET_AS_MEMBER_LOCATION",
    sourceLicense: institutionLocations.metadata.license,
    sourceAttribution: institutionLocations.metadata.attribution,
    sourcePurpose: institutionLocations.metadata.purpose,
    candidates: dispatchLocationCandidates,
  });
  await writeJson(path.join(outputRoot, "governance", "dispatch-organization-location-match-preview.json"), {
    policy: "REVIEW_EVERY_ORGANIZATION_MATCH; UNIQUE_NAME_CANDIDATE_IS_NOT_WRITE_AUTHORIZATION",
    matches: dispatchLocationMatchPreview,
    summary: {
      organizationCount: dispatchLocationMatchPreview.length,
      uniqueCandidateCount: dispatchLocationMatchPreview.filter((value) => value.candidateCount === 1).length,
      unmatchedCount: dispatchLocationMatchPreview.filter((value) => value.candidateCount === 0).length,
      ambiguousCount: dispatchLocationMatchPreview.filter((value) => value.candidateCount > 1).length,
    },
  });
  await writeJson(path.join(outputRoot, "governance", "runtime-history.json"), { records: runtimeHistory });
  await writeJson(path.join(outputRoot, "governance", "retained-source-fields.json"), {
    policy: "VALUES_REMAIN_IN_CHECKSUM_VERIFIED_SOURCE_PACKAGE; THIS_FILE_STORES_REFERENCES_ONLY",
    members: ["gender", "birth", "hometown", "education", "major", "remark", "unit", "position"],
    contacts: ["unit", "title", "accountId", "accountName", "avatar"],
    enterprises: ["annualRevenue", "taxPaid", "note", "history", "status", "createdBy", "updatedBy"],
  });

  return {
    outputRoot,
    packageName: verified.manifest.packageName,
    snapshotId,
    sourceClassification: "REFERENCE_EXPORT_NOT_FINAL",
    checksumVerifiedFileCount: verified.checksumVerifiedFileCount,
    entities: snapshot.entities as Record<LegacyEntityType, number>,
    attachmentCount: attachmentRows.length,
    manualReviewCount: review.length,
    mapCandidateCount: mapCandidates.length,
    dispatchLocationCandidateCount: dispatchLocationCandidates.length,
    dispatchLocationMatchPreviewCount: dispatchLocationMatchPreview.length,
  };
}
