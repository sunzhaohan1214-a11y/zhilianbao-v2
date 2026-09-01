import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareV1DataPackage } from "@/modules/migration/v1-package-adapter";

const temporaryRoots: string[] = [];

function digest(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function files(root: string, current = root): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) result.push(...await files(root, absolute));
    else result.push(path.relative(root, absolute).replaceAll("\\", "/"));
  }
  return result.sort();
}

async function writeJson(root: string, relative: string, value: unknown) {
  const absolute = path.join(root, relative);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function createPackage(generatedAt = "2026-08-31T15:14:14.898Z"): Promise<{ root: string; output: string }> {
  const parent = await mkdtemp(path.join(tmpdir(), "zhilianbao-v1-package-"));
  temporaryRoots.push(parent);
  const root = path.join(parent, "source");
  const output = path.join(parent, "output");
  await mkdir(root);
  await writeJson(root, "data/authoritative/members.full.json", {
    batches: [
      { id: "当前批", period: "2026年1月-2026年12月", memberCount: 1 },
      { id: "未来批", period: "2027年1月-2027年12月", memberCount: 1 },
    ],
    members: [
      { id: 1, batch: "当前批", name: "脱敏成员甲", contact: "13800000001", unit: "脱敏大学", position: "团员", photo: "/members/18/member_001.png" },
      { id: 2, batch: "未来批", name: "脱敏成员乙", contact: "13800000002", unit: "脱敏大学", position: "候选" },
    ],
  });
  await writeJson(root, "data/authoritative/contacts.full.json", {
    source: "fixture", updatedAt: "2026-08-31T00:00:00+08:00",
    categories: [{ key: "town", label: "镇区" }],
    contacts: [{ id: 1, category: "town", unit: "脱敏镇", name: "脱敏联系人", title: "联络员", phone: "13800000003" }],
  });
  await writeJson(root, "data/authoritative/member-institution-locations.json", {
    metadata: {
      license: "GPL-3.0-or-later",
      attribution: "作者全平台ID：宋夏天Dazzle；公众号：送你整个夏天",
      purpose: "TEST ONLY 派出单位城市级地图标注",
    },
    locations: [{ name: "脱敏大学", aliases: ["脱敏高校"], province: "测试省", city: "测试市", lng: 119.1, lat: 33.2 }],
  });
  await writeJson(root, "data/authoritative/enterprises.full.json", [{
    id: 1, name: "脱敏企业", town: "脱敏镇", address: "脱敏路1号", mainProducts: "脱敏产品",
    qualification: ["高新"], industries: ["制造"], tags: ["重点"], lng: "119.1", lat: "33.2", phone: "0514-88000000",
  }]);
  await writeJson(root, "reports/data-quality-report.json", {
    generatedAt, timezone: "Asia/Shanghai", counts: {},
    geoJson: [{ file: "maps/geojson/baoying_county.geojson.json", type: "FeatureCollection", featureCount: 1, validFeatureCollection: true }],
    warnings: [], exclusions: {},
  });
  const geoJson = { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[119, 33], [120, 33], [120, 34], [119, 33]]] } }] };
  await writeJson(root, "maps/geojson/baoying_county.geojson.json", geoJson);
  for (const name of ["users", "enterprise_records", "workflow_records", "member_records", "policy_documents", "audit_logs"]) {
    await writeJson(root, `data/runtime-history/${name}.json`, { sourceTable: name, recordCount: 0, records: [] });
  }
  await mkdir(path.join(root, "media/member-photos/18"), { recursive: true });
  await writeFile(path.join(root, "media/member-photos/18/member_001.png"), Buffer.from("fixture-image"));
  await writeFile(path.join(root, "MANIFEST.csv"), "path,bytes,sha256\n", "utf8");

  const payloadPaths = (await files(root)).filter((value) => value !== "MANIFEST.csv");
  const manifestFiles = [];
  for (const relative of payloadPaths) {
    const body = await readFile(path.join(root, relative));
    manifestFiles.push({ path: relative, bytes: body.byteLength, sha256: digest(body) });
  }
  await writeJson(root, "MANIFEST.json", { packageName: "sanitized-v1-reference-fixture", fileCount: manifestFiles.length, files: manifestFiles });
  const checksumPaths = await files(root);
  const checksumLines = [];
  for (const relative of checksumPaths) checksumLines.push(`${digest(await readFile(path.join(root, relative)))}  ${relative}`);
  await writeFile(path.join(root, "checksums.sha256"), `${checksumLines.join("\n")}\n`, "utf8");
  return { root, output };
}

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("V1 local reference package adapter", () => {
  it("verifies the package and emits a non-FULL, non-Git migration source bundle", async () => {
    const fixture = await createPackage();
    const result = await prepareV1DataPackage({ sourceRoot: fixture.root, outputRoot: fixture.output });
    expect(result).toMatchObject({ sourceClassification: "REFERENCE_EXPORT_NOT_FINAL", attachmentCount: 1, mapCandidateCount: 1, dispatchLocationCandidateCount: 1, dispatchLocationMatchPreviewCount: 1 });
    expect(result.entities).toMatchObject({ ORGANIZATION: 2, PERSON: 3, ENTERPRISE: 1 });

    const snapshot = JSON.parse(await readFile(path.join(fixture.output, "snapshot.json"), "utf8")) as Record<string, unknown>;
    expect(snapshot).toMatchObject({ snapshotKind: "SAMPLE", isSanitized: false, schemaVersion: "v1-package-reference-1" });
    const people = (await readFile(path.join(fixture.output, "entities/persons.ndjson"), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(people.map((value) => value.memberKind)).toEqual(expect.arrayContaining(["CURRENT", "FUTURE_MEMBER_CANDIDATE", "INTERNAL_STAFF"]));
    expect(people.every((value) => value.accountEligible === false)).toBe(true);
    const mapCatalog = JSON.parse(await readFile(path.join(fixture.output, "governance/map-candidates.json"), "utf8")) as { candidates: Array<Record<string, unknown>> };
    expect(mapCatalog.candidates[0]).toMatchObject({ disposition: "REVIEW_REQUIRED", coordinateRangeValid: true, featureNames: [] });
    const locationCatalog = JSON.parse(await readFile(path.join(fixture.output, "governance/dispatch-organization-location-candidates.json"), "utf8")) as { policy: string; candidates: Array<Record<string, unknown>> };
    expect(locationCatalog.policy).toContain("NEVER_INTERPRET_AS_MEMBER_LOCATION");
    expect(locationCatalog.candidates).toEqual([expect.objectContaining({ name: "脱敏大学", province: "测试省", city: "测试市", disposition: "REVIEW_REQUIRED", memberMapPath: ["中国", "测试省", "测试市", "脱敏大学"] })]);
    const matchPreview = JSON.parse(await readFile(path.join(fixture.output, "governance/dispatch-organization-location-match-preview.json"), "utf8")) as { summary: Record<string, number>; matches: Array<Record<string, unknown>> };
    expect(matchPreview.summary).toEqual({ organizationCount: 1, uniqueCandidateCount: 1, unmatchedCount: 0, ambiguousCount: 0 });
    expect(matchPreview.matches[0]).toMatchObject({ candidateCount: 1, disposition: "REVIEW_REQUIRED", reviewCode: "DISPATCH_LOCATION_MATCH_CONFIRMATION_REQUIRED" });
    expect((await stat(fixture.output)).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(fixture.output, "snapshot.json"))).mode & 0o777).toBe(0o600);
    const attachmentManifest = (await readFile(path.join(fixture.output, "attachments/manifest.ndjson"), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { relativePath: string });
    expect((await stat(path.join(fixture.output, "attachments", "blobs", attachmentManifest[0].relativePath))).mode & 0o777).toBe(0o600);
  });

  it("fails closed when a checksummed payload changes", async () => {
    const fixture = await createPackage();
    await writeFile(path.join(fixture.root, "data/authoritative/enterprises.full.json"), "[]\n", "utf8");
    await expect(prepareV1DataPackage({ sourceRoot: fixture.root, outputRoot: fixture.output })).rejects.toThrow("V1_PACKAGE_CHECKSUM_MISMATCH");
  });

  it("rejects output nested inside the sensitive source package", async () => {
    const fixture = await createPackage();
    await expect(prepareV1DataPackage({ sourceRoot: fixture.root, outputRoot: path.join(fixture.root, "generated") })).rejects.toThrow("V1_PACKAGE_OUTPUT_PATH_OVERLAP");
  });

  it("rejects a symlinked output alias back into the sensitive source package", async () => {
    const fixture = await createPackage();
    const aliasRoot = path.join(path.dirname(fixture.root), "source-alias");
    await symlink(fixture.root, aliasRoot, "dir");
    await expect(prepareV1DataPackage({ sourceRoot: fixture.root, outputRoot: path.join(aliasRoot, "generated") })).rejects.toThrow("V1_PACKAGE_OUTPUT_SYMLINK_REJECTED");
    await expect(readFile(path.join(fixture.root, "generated", "snapshot.json"), "utf8")).rejects.toThrow();
  });

  it("classifies batch membership by the Asia/Shanghai natural day", async () => {
    const fixture = await createPackage("2026-12-31T16:30:00.000Z");
    await prepareV1DataPackage({ sourceRoot: fixture.root, outputRoot: fixture.output });
    const people = (await readFile(path.join(fixture.output, "entities/persons.ndjson"), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { sourceId: string; memberKind: string });
    expect(people.find((person) => person.sourceId === "MEMBER-1")?.memberKind).toBe("ALUMNI_HISTORICAL");
    expect(people.find((person) => person.sourceId === "MEMBER-2")?.memberKind).toBe("CURRENT");
  });
});
