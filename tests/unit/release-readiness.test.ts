import { createHash } from "node:crypto";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IANA_IPV6_ALLOCATED_GLOBAL_UNICAST_PREFIXES, IANA_IPV6_SPECIAL_PURPOSE_PREFIXES, REQUIRED_CI_JOBS, buildReleaseReadiness, ipv6PrefixMatches, isPinnedSafeRemoteAddress, isSafePublicIpAddress, readinessExitCode, validateAiEvidence, validateBackupEvidence,
  validateExactHeadCi, validateGenericEvidence as validateGenericEvidenceWithoutDependencies, validateGenericEvidenceWithDependencies, validateGithubProtection, validateMaintenanceEvidence,
  validateMigrationEvidence, validatePreflightEvidence, validateRestoreEvidence, validateScannerEvidence,
  validateUatEvidence, type EvidenceLoadingDependencies, type EvidenceValidation, type ExternalEvidenceCategory, type ReleaseGateInputs,
} from "@/modules/hardening/release-readiness";

const candidateSha = "1".repeat(40);
const verifiedAt = "2026-08-29T00:00:00.000Z";
const temporaryDirectories: string[] = [];

function validateGenericEvidence(raw: string | undefined, sha: string, category: ExternalEvidenceCategory, environment: "TEST" | "PROD", missingStatus: Parameters<typeof validateGenericEvidenceWithoutDependencies>[4] = "BLOCKED_BY_EXTERNAL_ENV", dependencies?: EvidenceLoadingDependencies) {
  return dependencies
    ? validateGenericEvidenceWithDependencies(raw, sha, category, environment, missingStatus, dependencies)
    : validateGenericEvidenceWithoutDependencies(raw, sha, category, environment, missingStatus);
}

async function evidence(category: ExternalEvidenceCategory, environment: "TEST" | "PROD", details: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "zlb-evidence-")); temporaryDirectories.push(directory);
  const sourcePath = join(directory, `${category}.json`);
  const content = JSON.stringify({ category, candidateSha, environment, status: "PASS", verifiedAt, details, ...overrides });
  await writeFile(sourcePath, content);
  const digest = createHash("sha256").update(content).digest("hex");
  return JSON.stringify({ reference: `urn:sha256:${digest}`, sourcePath });
}

async function evidenceFixture(category: ExternalEvidenceCategory, environment: "TEST" | "PROD", details: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "zlb-evidence-")); temporaryDirectories.push(directory);
  const sourcePath = join(directory, `${category}.json`);
  const content = JSON.stringify({ category, candidateSha, environment, status: "PASS", verifiedAt, details, ...overrides });
  await writeFile(sourcePath, content);
  const digest = createHash("sha256").update(content).digest("hex");
  return { content, digest, sourcePath, reference: `https://93.184.216.34/evidence.json?sha256=${digest}` };
}

function responseBody(...chunks: Array<string | Uint8Array>): AsyncIterable<string | Uint8Array> {
  return (async function* body() { for (const chunk of chunks) yield chunk; })();
}

function referenceDependencies(content: string, overrides: Partial<EvidenceLoadingDependencies> = {}): EvidenceLoadingDependencies {
  return {
    requestReference: vi.fn(async () => ({ statusCode: 200, contentLength: String(Buffer.byteLength(content)), body: responseBody(content) })),
    ...overrides,
  };
}

const blocked = (): EvidenceValidation => ({ status: "BLOCKED_BY_EXTERNAL_ENV", errorCode: "TEST_EVIDENCE_MISSING" });
function completeProtection() { return { required_pull_request_reviews: { required_approving_review_count: 1, dismiss_stale_reviews: true }, required_status_checks: { contexts: [...REQUIRED_CI_JOBS] }, required_conversation_resolution: { enabled: true }, enforce_admins: { enabled: true }, allow_force_pushes: { enabled: false } }; }
function successfulCi(sha = candidateSha) { return validateExactHeadCi({ head_sha: sha, status: "completed", conclusion: "success", html_url: "https://github.example/actions/runs/123" }, REQUIRED_CI_JOBS.map((name) => ({ name, status: "completed", conclusion: "success" })), candidateSha); }
function inputs(overrides: Partial<ReleaseGateInputs> = {}): ReleaseGateInputs {
  return { mode: "prod", appEnvironment: "PROD", appVersion: candidateSha, fakeProvidersEnabled: false, scannerConfigured: true, backupConfigured: true, scannerEvidence: blocked(), backupEvidence: blocked(), maintenanceEvidence: blocked(), restoreEvidence: blocked(), migrationEvidence: blocked(), githubProtection: blocked(), exactHeadCi: blocked(), uatEvidence: blocked(), preflightEvidence: blocked(), ...overrides };
}

function ipv6BigInt(value: string): bigint {
  const halves = value.toLowerCase().split("::");
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves[1] ? halves[1].split(":") : [];
  const words = halves.length === 2 ? [...head, ...Array.from({ length: 8 - head.length - tail.length }, () => "0"), ...tail] : head;
  return words.reduce((result, word) => (result << BigInt(16)) | BigInt(`0x${word || "0"}`), BigInt(0));
}

function expandedIpv6(value: bigint): string {
  return Array.from({ length: 8 }, (_, index) => Number((value >> BigInt((7 - index) * 16)) & BigInt(0xffff)).toString(16)).join(":");
}

function cidrBoundarySamples(cidr: string): { first: string; interior: string; last: string; neighbor: string } {
  const [address, rawLength] = cidr.split("/");
  const prefixLength = Number(rawLength);
  const hostBits = BigInt(128 - prefixLength);
  const hostMask = hostBits === BigInt(0) ? BigInt(0) : (BigInt(1) << hostBits) - BigInt(1);
  const network = ipv6BigInt(address) & (((BigInt(1) << BigInt(128)) - BigInt(1)) ^ hostMask);
  const last = network | hostMask;
  const interior = network | (hostMask >> BigInt(1));
  const neighbor = last < (BigInt(1) << BigInt(128)) - BigInt(1) ? last + BigInt(1) : network - BigInt(1);
  return { first: expandedIpv6(network), interior: expandedIpv6(interior), last: expandedIpv6(last), neighbor: expandedIpv6(neighbor) };
}

async function completeExternalEvidence() {
  return {
    scannerEvidence: await validateScannerEvidence(await evidence("scanner", "PROD", { provider: "clamav", health: "READY", cleanAccepted: true, eicarRejected: true }), candidateSha),
    backupEvidence: await validateBackupEvidence(await evidence("backup", "PROD", { provider: "tencent-cynosdb", health: "READY", backupStatus: "SUCCEEDED", sourceEnvironment: "PROD", region: "ap-shanghai", clusterId: "cluster-1", vpcId: "vpc-1", subnetId: "subnet-1", snapshotAt: "2026-08-28T12:00:00.000Z" }), candidateSha, { region: "ap-shanghai", clusterId: "cluster-1", vpcId: "vpc-1", subnetId: "subnet-1" }, new Date(verifiedAt)),
    maintenanceEvidence: await validateMaintenanceEvidence(await evidence("maintenance", "PROD", { provider: "maintenance-api", health: "READY", enterPassed: true, exitPassed: true }), candidateSha),
    restoreEvidence: await validateRestoreEvidence(await evidence("restore", "TEST", { sourceBackupId: "123", sourceClusterId: "test-source", sourceEnvironment: "TEST", targetClusterId: "test-target", targetEnvironment: "TEST", validationPassed: true, rtoHours: 2, rpoHours: 1, cleanupCompleted: true }), candidateSha),
    migrationEvidence: await validateMigrationEvidence(await evidence("migration", "TEST", { sourceSnapshotIdentity: "snapshot-1", targetMigrationDatabase: "migration-test", dryRunPassed: true, applyPassed: true, rerunPassed: true, reconciliationPassed: true }), candidateSha),
    uatEvidence: await validateUatEvidence(await evidence("uat", "TEST", { p0Open: 0, p1Open: 0, businessSignoff: true, operationsSignoff: true }), candidateSha),
    preflightEvidence: await validatePreflightEvidence(await evidence("preflight", "PROD", { checksPassed: true, rollbackReady: true, changeWindowApproved: true }), candidateSha),
    realAiEvidence: await validateAiEvidence(await evidence("ai", "PROD", { provider: "real-provider", model: "approved-model", evaluationPassed: true }), candidateSha),
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  vi.unstubAllGlobals();
  delete process.env.REAL_RESTORE_DRILL_PASSED; delete process.env.FULL_V1_REHEARSAL_PASSED; delete process.env.UAT_SIGNED_OFF; delete process.env.REAL_MAINTENANCE_PROVIDER_READY;
});

describe("M3-008 IPv6 public-address classification", () => {
  it.each([
    ["fc00::1", "fc00::/7", true], ["fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff", "fc00::/7", true], ["fe00::1", "fc00::/7", false],
    ["fe80::1", "fe80::/10", true], ["febf:ffff::1", "fe80::/10", true], ["fec0::1", "fe80::/10", false],
    ["3fff::1", "3fff::/20", true], ["3fff:0fff:ffff::1", "3fff::/20", true], ["3fff:1000::1", "3fff::/20", false], ["4000::1", "3fff::/20", false],
    ["5f00::1", "5f00::/16", true], ["5f00:ffff::1", "5f00::/16", true], ["5eff::1", "5f00::/16", false], ["6000::1", "5f00::/16", false],
    ["2001::1", "2001::/23", true], ["2001:1ff:ffff::1", "2001::/23", true], ["2001:200::1", "2001::/23", false],
    ["2001:db8::1", "2001:db8::/32", true], ["2001:db9::1", "2001:db8::/32", false],
    ["64:ff9b:1::1", "64:ff9b:1::/48", true], ["64:ff9b:2::1", "64:ff9b:1::/48", false],
    ["100:0:0:1::1", "100:0:0:1::/64", true], ["100:0:0:1:ffff::1", "100:0:0:1::/64", true], ["100:0:0:2::1", "100:0:0:1::/64", false],
    ["::ffff:127.0.0.1", "::ffff:0:0/96", true], ["::fffe:ffff:ffff", "::ffff:0:0/96", false],
  ] as const)("matches %s against %s as %s", (address, prefix, expected) => {
    expect(ipv6PrefixMatches(address, prefix)).toBe(expected);
  });

  it.each(IANA_IPV6_SPECIAL_PURPOSE_PREFIXES)("matches the first, interior, and last address of IANA prefix %s only", (prefix) => {
    const samples = cidrBoundarySamples(prefix);
    expect(ipv6PrefixMatches(samples.first, prefix)).toBe(true);
    expect(ipv6PrefixMatches(samples.interior, prefix)).toBe(true);
    expect(ipv6PrefixMatches(samples.last, prefix)).toBe(true);
    expect(ipv6PrefixMatches(samples.neighbor, prefix)).toBe(false);
    expect(isSafePublicIpAddress(samples.first)).toBe(false);
    expect(isSafePublicIpAddress(samples.interior)).toBe(false);
    expect(isSafePublicIpAddress(samples.last)).toBe(false);
  });

  it.each(IANA_IPV6_ALLOCATED_GLOBAL_UNICAST_PREFIXES)("matches all boundaries of IANA allocated global-unicast prefix %s", (prefix) => {
    const samples = cidrBoundarySamples(prefix);
    expect(ipv6PrefixMatches(samples.first, prefix)).toBe(true);
    expect(ipv6PrefixMatches(samples.interior, prefix)).toBe(true);
    expect(ipv6PrefixMatches(samples.last, prefix)).toBe(true);
    expect(ipv6PrefixMatches(samples.neighbor, prefix)).toBe(false);
  });

  it.each([
    "::1", "::", "fc00::1", "fd00::1", "fe80::1", "fec0::1", "ff02::1", "2001:db8::1", "3fff::1", "5f00::1",
    "100::1", "100:0:0:1::1", "64:ff9b::1", "64:ff9b:1::1", "2002::1", "2001:1::1", "2001:3::1", "2620:4f:8000::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "::ffff:a00:1", "::ffff:169.254.169.254", "::ffff:a9fe:a9fe",
    "::ffff:172.16.0.1", "::ffff:ac10:1", "::ffff:192.168.0.1", "::ffff:c0a8:1", "::127.0.0.1", "3FFF:0000:0000:0000:0000:0000:0000:0001",
    "2d00::1", "3000::1", "3ffe::1", "3fff:1000::1", "4000::1", "6000::1", "not-an-ip", "fe80::1%eth0",
  ])("rejects non-public or special-purpose IPv6 address %s", (address) => {
    expect(isSafePublicIpAddress(address)).toBe(false);
  });

  it.each([
    "2001:4860:4860::8888",
    "2404:6800:4005:80a::200e",
    "2606:2800:220:1:248:1893:25c8:1946",
    "2606:4700:4700::1111",
    "2a00:1450:4009:80b::200e",
  ])("allows classifier-only global public unicast sample %s", (address) => {
    expect(isSafePublicIpAddress(address)).toBe(true);
  });

  it("normalizes equivalent IPv6 forms and fails closed on malformed CIDRs", () => {
    expect(ipv6PrefixMatches("3FFF:0000:0000:0000:0000:0000:0000:0001", "3fff::/20")).toBe(true);
    expect(ipv6PrefixMatches("::ffff:127.0.0.1", "::ffff:0:0/96")).toBe(true);
    expect(ipv6PrefixMatches("3fff::1", "invalid/20")).toBe(false);
    expect(ipv6PrefixMatches("3fff::1", "3fff::/129")).toBe(false);
  });

  it("requires the connected remote address to remain public and equal to the pinned address", () => {
    expect(isPinnedSafeRemoteAddress("2606:2800:220:1:0248:1893:25c8:1946", "2606:2800:220:1:248:1893:25c8:1946")).toBe(true);
    expect(isPinnedSafeRemoteAddress("3fff::1", "3fff::1")).toBe(false);
    expect(isPinnedSafeRemoteAddress("2606:4700:4700::1111", "2606:4700:4700::1001")).toBe(false);
    expect(isPinnedSafeRemoteAddress(undefined, "2606:4700:4700::1111")).toBe(false);
  });
});

describe("M3-008 external evidence sources", () => {
  it("accepts valid sourcePath-only evidence bound by an immutable digest", async () => {
    await expect(validateGenericEvidence(await evidence("uat", "TEST"), candidateSha, "uat", "TEST")).resolves.toMatchObject({ status: "PASS" });
  });

  it("rejects sourcePath-only evidence with a digest mismatch", async () => {
    const fixture = await evidenceFixture("uat", "TEST");
    await expect(validateGenericEvidence(JSON.stringify({ sourcePath: fixture.sourcePath, reference: `urn:sha256:${"0".repeat(64)}` }), candidateSha, "uat", "TEST")).resolves.toMatchObject({ status: "FAIL" });
  });

  it("accepts valid HTTPS-reference-only evidence", async () => {
    const fixture = await evidenceFixture("uat", "TEST");
    await expect(validateGenericEvidence(JSON.stringify({ reference: fixture.reference }), candidateSha, "uat", "TEST", "BLOCKED_BY_EXTERNAL_ENV", referenceDependencies(fixture.content))).resolves.toMatchObject({ status: "PASS" });
  });

  it("fails closed when an HTTPS-reference-only source is unreachable", async () => {
    const fixture = await evidenceFixture("uat", "TEST");
    const dependencies: EvidenceLoadingDependencies = { requestReference: vi.fn(async () => { throw new TypeError("network unavailable"); }) };
    await expect(validateGenericEvidence(JSON.stringify({ reference: fixture.reference }), candidateSha, "uat", "TEST", "BLOCKED_BY_EXTERNAL_ENV", dependencies)).resolves.toMatchObject({ status: "FAIL", errorCode: "EVIDENCE_REFERENCE_UNREACHABLE" });
  });

  it("sourcePath must not bypass declared HTTPS reference", async () => {
    const fixture = await evidenceFixture("uat", "TEST");
    const dependencies: EvidenceLoadingDependencies = { requestReference: vi.fn(async () => { throw new TypeError("network unavailable"); }) };
    await expect(validateGenericEvidence(JSON.stringify({ sourcePath: fixture.sourcePath, reference: fixture.reference }), candidateSha, "uat", "TEST", "BLOCKED_BY_EXTERNAL_ENV", dependencies)).resolves.toMatchObject({ status: "FAIL" });
  });

  it("rejects a valid sourcePath when the HTTPS reference digest mismatches", async () => {
    const fixture = await evidenceFixture("uat", "TEST");
    await expect(validateGenericEvidence(JSON.stringify({ sourcePath: fixture.sourcePath, reference: fixture.reference }), candidateSha, "uat", "TEST", "BLOCKED_BY_EXTERNAL_ENV", referenceDependencies(`${fixture.content} `))).resolves.toMatchObject({ status: "FAIL" });
  });

  it("rejects a sourcePath digest mismatch even when HTTPS content is valid", async () => {
    const fixture = await evidenceFixture("uat", "TEST");
    await writeFile(fixture.sourcePath, `${fixture.content} `);
    await expect(validateGenericEvidence(JSON.stringify({ sourcePath: fixture.sourcePath, reference: fixture.reference }), candidateSha, "uat", "TEST", "BLOCKED_BY_EXTERNAL_ENV", referenceDependencies(fixture.content))).resolves.toMatchObject({ status: "FAIL" });
  });

  it("accepts matching valid sourcePath and HTTPS content", async () => {
    const fixture = await evidenceFixture("uat", "TEST");
    await expect(validateGenericEvidence(JSON.stringify({ sourcePath: fixture.sourcePath, reference: fixture.reference }), candidateSha, "uat", "TEST", "BLOCKED_BY_EXTERNAL_ENV", referenceDependencies(fixture.content))).resolves.toMatchObject({ status: "PASS" });
  });

  it("rejects different sourcePath and HTTPS content", async () => {
    const fixture = await evidenceFixture("uat", "TEST");
    const remoteContent = fixture.content.replace('"status":"PASS"', '"status":"FAIL"');
    await expect(validateGenericEvidence(JSON.stringify({ sourcePath: fixture.sourcePath, reference: fixture.reference }), candidateSha, "uat", "TEST", "BLOCKED_BY_EXTERNAL_ENV", referenceDependencies(remoteContent))).resolves.toMatchObject({ status: "FAIL" });
  });

  it("rejects unsafe reference schemes", async () => {
    const fixture = await evidenceFixture("uat", "TEST");
    await expect(validateGenericEvidence(JSON.stringify({ sourcePath: fixture.sourcePath, reference: `file://${fixture.sourcePath}?sha256=${fixture.digest}` }), candidateSha, "uat", "TEST")).resolves.toMatchObject({ status: "FAIL", errorCode: "EVIDENCE_REFERENCE_UNSAFE" });
  });

  it("rejects loopback, private, link-local, metadata, and documentation IPv4 targets before request", async () => {
    const digest = "0".repeat(64);
    const requestReference = vi.fn();
    for (const host of ["127.0.0.1", "localhost", "10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.0.1", "169.254.169.254", "192.88.99.1", "198.51.100.1"]) {
      await expect(validateGenericEvidence(JSON.stringify({ reference: `https://${host}/evidence.json?sha256=${digest}` }), candidateSha, "uat", "TEST", "BLOCKED_BY_EXTERNAL_ENV", { requestReference })).resolves.toMatchObject({ status: "FAIL", errorCode: "EVIDENCE_REFERENCE_UNSAFE" });
    }
    expect(requestReference).not.toHaveBeenCalled();
  });

  it("rejects hexadecimal IPv4-mapped IPv6 loopback and private targets before request", async () => {
    const digest = "0".repeat(64);
    const requestReference = vi.fn();
    for (const host of ["[::ffff:7f00:1]", "[::ffff:a00:1]"]) {
      await expect(validateGenericEvidence(JSON.stringify({ reference: `https://${host}/evidence.json?sha256=${digest}` }), candidateSha, "uat", "TEST", "BLOCKED_BY_EXTERNAL_ENV", { requestReference })).resolves.toMatchObject({ status: "FAIL", errorCode: "EVIDENCE_REFERENCE_UNSAFE" });
    }
    expect(requestReference).not.toHaveBeenCalled();
  });

  it("rejects IPv6 loopback, link-local, unique-local, and documentation targets", async () => {
    const digest = "0".repeat(64);
    const requestReference = vi.fn();
    for (const host of ["[::1]", "[fe80::1]", "[fc00::1]", "[64:ff9b::a00:1]", "[2001:db8::1]", "[2002:0a00:0001::]"]) {
      await expect(validateGenericEvidence(JSON.stringify({ reference: `https://${host}/evidence.json?sha256=${digest}` }), candidateSha, "uat", "TEST", "BLOCKED_BY_EXTERNAL_ENV", { requestReference })).resolves.toMatchObject({ status: "FAIL", errorCode: "EVIDENCE_REFERENCE_UNSAFE" });
    }
    expect(requestReference).not.toHaveBeenCalled();
  });

  it.each(["[3fff::1]", "[5f00::1]", "[100:0:0:1::1]"])("rejects current IANA special-purpose IPv6 gap %s before request", async (host) => {
    const fixture = await evidenceFixture("uat", "TEST");
    const requestReference = vi.fn(async () => ({ statusCode: 200, body: responseBody(fixture.content) }));
    const reference = fixture.reference.replace("93.184.216.34", host);
    await expect(validateGenericEvidence(JSON.stringify({ reference }), candidateSha, "uat", "TEST", "BLOCKED_BY_EXTERNAL_ENV", { requestReference })).resolves.toMatchObject({ status: "FAIL", errorCode: "EVIDENCE_REFERENCE_UNSAFE" });
    expect(requestReference).not.toHaveBeenCalled();
  });

  it("rejects hostnames when DNS returns private or mixed public/private addresses", async () => {
    const digest = "0".repeat(64);
    const requestReference = vi.fn();
    for (const addresses of [
      [{ address: "10.0.0.1", family: 4 as const }],
      [{ address: "93.184.216.34", family: 4 as const }, { address: "127.0.0.1", family: 4 as const }],
    ]) {
      await expect(validateGenericEvidence(JSON.stringify({ reference: `https://evidence.example/item?sha256=${digest}` }), candidateSha, "uat", "TEST", "BLOCKED_BY_EXTERNAL_ENV", { resolveHost: vi.fn(async () => addresses), requestReference })).resolves.toMatchObject({ status: "FAIL", errorCode: "EVIDENCE_REFERENCE_UNSAFE" });
    }
    expect(requestReference).not.toHaveBeenCalled();
  });

  it.each(["3fff::1", "5f00::1", "100:0:0:1::1"])("rejects DNS results containing special-purpose IPv6 address %s", async (unsafeAddress) => {
    const digest = "0".repeat(64);
    const requestReference = vi.fn();
    const addresses = [
      { address: "2606:4700:4700::1111", family: 6 as const },
      { address: unsafeAddress, family: 6 as const },
    ];
    await expect(validateGenericEvidence(JSON.stringify({ reference: `https://evidence.example/item?sha256=${digest}` }), candidateSha, "uat", "TEST", "BLOCKED_BY_EXTERNAL_ENV", { resolveHost: vi.fn(async () => addresses), requestReference })).resolves.toMatchObject({ status: "FAIL", errorCode: "EVIDENCE_REFERENCE_UNSAFE" });
    expect(requestReference).not.toHaveBeenCalled();
  });

  it("times out DNS independently and never starts an HTTPS request", async () => {
    const digest = "0".repeat(64);
    const requestReference = vi.fn();
    const resolveHost = vi.fn(() => new Promise<Array<{ address: string; family: 4 }>>(() => undefined));
    await expect(validateGenericEvidence(JSON.stringify({ reference: `https://evidence.example/item?sha256=${digest}` }), candidateSha, "uat", "TEST", "BLOCKED_BY_EXTERNAL_ENV", { resolveHost, requestReference, dnsTimeoutMs: 5 })).resolves.toMatchObject({ status: "FAIL", errorCode: "EVIDENCE_REFERENCE_DNS_TIMEOUT" });
    expect(requestReference).not.toHaveBeenCalled();
  });

  it("passes the complete vetted DNS set to a single pinned HTTPS request", async () => {
    const fixture = await evidenceFixture("uat", "TEST");
    const reference = fixture.reference.replace("93.184.216.34", "evidence.example");
    const addresses = [{ address: "93.184.216.34", family: 4 as const }, { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 as const }];
    const resolveHost = vi.fn(async () => addresses);
    const requestReference = vi.fn(async (input: { url: URL; addresses: readonly typeof addresses[number][] }) => {
      expect(input.url.hostname).toBe("evidence.example");
      expect(input.addresses).toEqual(addresses);
      return { statusCode: 200, body: responseBody(fixture.content) };
    });
    await expect(validateGenericEvidence(JSON.stringify({ reference }), candidateSha, "uat", "TEST", "BLOCKED_BY_EXTERNAL_ENV", { resolveHost, requestReference })).resolves.toMatchObject({ status: "PASS" });
    expect(resolveHost).toHaveBeenCalledTimes(1);
    expect(requestReference).toHaveBeenCalledTimes(1);
  });

  it("fails closed on HTTPS reference timeout", async () => {
    const fixture = await evidenceFixture("uat", "TEST");
    const requestReference: NonNullable<EvidenceLoadingDependencies["requestReference"]> = vi.fn(({ signal }) => new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("timed out", "AbortError")), { once: true })));
    await expect(validateGenericEvidence(JSON.stringify({ reference: fixture.reference }), candidateSha, "uat", "TEST", "BLOCKED_BY_EXTERNAL_ENV", { requestReference, requestTimeoutMs: 5 })).resolves.toMatchObject({ status: "FAIL", errorCode: "EVIDENCE_REFERENCE_TIMEOUT" });
  });

  it("keeps the HTTPS timeout active while the response body is stalled", async () => {
    const fixture = await evidenceFixture("uat", "TEST");
    const cancel = vi.fn();
    const body = { [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<Uint8Array>>(() => undefined) }) };
    const requestReference: NonNullable<EvidenceLoadingDependencies["requestReference"]> = vi.fn(async () => ({ statusCode: 200, body, cancel }));
    await expect(validateGenericEvidence(JSON.stringify({ reference: fixture.reference }), candidateSha, "uat", "TEST", "BLOCKED_BY_EXTERNAL_ENV", { requestReference, requestTimeoutMs: 5 })).resolves.toMatchObject({ status: "FAIL", errorCode: "EVIDENCE_REFERENCE_TIMEOUT" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("fails closed on redirects and non-2xx HTTPS responses", async () => {
    const fixture = await evidenceFixture("uat", "TEST");
    for (const statusCode of [302, 503]) {
      const dependencies: EvidenceLoadingDependencies = { requestReference: vi.fn(async () => ({ statusCode, body: responseBody("unavailable") })) };
      await expect(validateGenericEvidence(JSON.stringify({ reference: fixture.reference }), candidateSha, "uat", "TEST", "BLOCKED_BY_EXTERNAL_ENV", dependencies)).resolves.toMatchObject({ status: "FAIL", errorCode: "EVIDENCE_REFERENCE_HTTP_ERROR" });
    }
  });

  it("fails closed on declared and streamed oversized HTTPS responses", async () => {
    const fixture = await evidenceFixture("uat", "TEST");
    const bodies = [
      { statusCode: 200, contentLength: "1048577", body: responseBody() },
      { statusCode: 200, body: responseBody(new Uint8Array(1_048_576), new Uint8Array(1)) },
    ];
    for (const response of bodies) {
      const dependencies: EvidenceLoadingDependencies = { requestReference: vi.fn(async () => response) };
      await expect(validateGenericEvidence(JSON.stringify({ reference: fixture.reference }), candidateSha, "uat", "TEST", "BLOCKED_BY_EXTERNAL_ENV", dependencies)).resolves.toMatchObject({ status: "FAIL", errorCode: "EVIDENCE_REFERENCE_TOO_LARGE" });
    }
  });

  it("does not expose sensitive HTTPS query values in validation output", async () => {
    const fixture = await evidenceFixture("uat", "TEST");
    const reference = `${fixture.reference}&token=secret-value`;
    const dependencies: EvidenceLoadingDependencies = { requestReference: vi.fn(async () => { throw new TypeError("network unavailable"); }) };
    const result = await validateGenericEvidence(JSON.stringify({ reference }), candidateSha, "uat", "TEST", "BLOCKED_BY_EXTERNAL_ENV", dependencies);
    expect(result).toMatchObject({ status: "FAIL", evidenceRef: "https://93.184.216.34/evidence.json" });
    expect(JSON.stringify(result)).not.toContain("secret-value");
  });

  it("rejects local symbolic links before opening the target", async () => {
    const openSource = vi.fn();
    const symbolicLink = { isSymbolicLink: () => true, isFile: () => false } as never;
    const raw = JSON.stringify({ sourcePath: "ignored", reference: `urn:sha256:${"0".repeat(64)}` });
    await expect(validateGenericEvidence(raw, candidateSha, "uat", "TEST", "BLOCKED_BY_EXTERNAL_ENV", { lstatSource: vi.fn(async () => symbolicLink), openSource })).resolves.toMatchObject({ status: "FAIL", errorCode: "EVIDENCE_SOURCE_INVALID" });
    expect(openSource).not.toHaveBeenCalled();
  });

  it("rejects oversized local files without an unbounded read", async () => {
    const fixture = await evidenceFixture("uat", "TEST");
    await writeFile(fixture.sourcePath, new Uint8Array(1_048_577));
    await expect(validateGenericEvidence(JSON.stringify({ sourcePath: fixture.sourcePath, reference: `urn:sha256:${fixture.digest}` }), candidateSha, "uat", "TEST")).resolves.toMatchObject({ status: "FAIL", errorCode: "EVIDENCE_SOURCE_TOO_LARGE" });
  });

  it("rejects a local file that grows beyond the cap after the first handle stat", async () => {
    const fixture = await evidenceFixture("uat", "TEST");
    const dependencies: EvidenceLoadingDependencies = { afterSourceOpen: async (sourcePath) => writeFile(sourcePath, new Uint8Array(1_048_577)) };
    await expect(validateGenericEvidence(JSON.stringify({ sourcePath: fixture.sourcePath, reference: `urn:sha256:${fixture.digest}` }), candidateSha, "uat", "TEST", "BLOCKED_BY_EXTERNAL_ENV", dependencies)).resolves.toMatchObject({ status: "FAIL", errorCode: "EVIDENCE_SOURCE_TOO_LARGE" });
  });

  it("detects local file mutation through before/after handle metadata", async () => {
    const fixture = await evidenceFixture("uat", "TEST");
    const dependencies: EvidenceLoadingDependencies = { afterSourceOpen: async (sourcePath) => writeFile(sourcePath, `${fixture.content} changed`) };
    await expect(validateGenericEvidence(JSON.stringify({ sourcePath: fixture.sourcePath, reference: `urn:sha256:${fixture.digest}` }), candidateSha, "uat", "TEST", "BLOCKED_BY_EXTERNAL_ENV", dependencies)).resolves.toMatchObject({ status: "FAIL", errorCode: "EVIDENCE_SOURCE_CHANGED" });
  });

  it("keeps reading the opened file handle when the path is replaced", async () => {
    const fixture = await evidenceFixture("uat", "TEST");
    const movedPath = `${fixture.sourcePath}.opened`;
    const dependencies: EvidenceLoadingDependencies = {
      afterSourceOpen: async (sourcePath) => {
        await rename(sourcePath, movedPath);
        await writeFile(sourcePath, "replacement must not be read");
      },
    };
    await expect(validateGenericEvidence(JSON.stringify({ sourcePath: fixture.sourcePath, reference: `urn:sha256:${fixture.digest}` }), candidateSha, "uat", "TEST", "BLOCKED_BY_EXTERNAL_ENV", dependencies)).resolves.toMatchObject({ status: "PASS" });
  });

  it("rejects non-regular local evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "zlb-evidence-dir-")); temporaryDirectories.push(directory);
    const raw = JSON.stringify({ sourcePath: directory, reference: `urn:sha256:${"0".repeat(64)}` });
    await expect(validateGenericEvidence(raw, candidateSha, "uat", "TEST")).resolves.toMatchObject({ status: "FAIL", errorCode: "EVIDENCE_SOURCE_INVALID" });
  });
});

describe("M3-008 production release evidence", () => {
  it("does not become release-ready when settings exist without real evidence", () => {
    const report = buildReleaseReadiness(inputs()); expect(report.releaseReady).toBe(false);
    expect(report.gates.find(({ code }) => code === "FILE_SCANNER_PRODUCTION_EVIDENCE")?.status).toBe("BLOCKED_BY_EXTERNAL_ENV");
  });

  it("does not accept legacy naked boolean switches as immutable evidence", () => {
    process.env.REAL_RESTORE_DRILL_PASSED = "true"; process.env.FULL_V1_REHEARSAL_PASSED = "true"; process.env.UAT_SIGNED_OFF = "true"; process.env.REAL_MAINTENANCE_PROVIDER_READY = "true";
    expect(buildReleaseReadiness(inputs()).releaseReady).toBe(false);
  });

  it("re-reads referenced content and rejects a mismatched SHA-256", async () => {
    const pointer = JSON.parse(await evidence("uat", "TEST", { p0Open: 0, p1Open: 0, businessSignoff: true, operationsSignoff: true })) as { reference: string; sourcePath: string };
    await writeFile(pointer.sourcePath, JSON.stringify({ category: "uat", candidateSha, environment: "TEST", status: "PASS", verifiedAt, details: { p0Open: 1 } }));
    await expect(validateUatEvidence(JSON.stringify(pointer), candidateSha)).resolves.toMatchObject({ status: "FAIL", errorCode: "EVIDENCE_SOURCE_DIGEST_MISMATCH" });
  });

  it("rejects category, candidate, environment, and category-schema mismatches", async () => {
    await expect(validateUatEvidence(await evidence("migration", "TEST", {}), candidateSha)).resolves.toMatchObject({ errorCode: "EVIDENCE_CATEGORY_MISMATCH" });
    await expect(validateUatEvidence(await evidence("uat", "TEST", { p0Open: 0, p1Open: 0, businessSignoff: true, operationsSignoff: true }, { candidateSha: "2".repeat(40) }), candidateSha)).resolves.toMatchObject({ errorCode: "EVIDENCE_CANDIDATE_SHA_MISMATCH" });
    await expect(validateGenericEvidence(await evidence("maintenance", "PROD", {}), candidateSha, "maintenance", "TEST")).resolves.toMatchObject({ errorCode: "EVIDENCE_ENVIRONMENT_MISMATCH" });
    await expect(validateUatEvidence(await evidence("uat", "TEST", { p0Open: 0, p1Open: 0, businessSignoff: true }), candidateSha)).resolves.toMatchObject({ errorCode: "UAT_EVIDENCE_INCOMPLETE" });
  });

  it("requires full migration and restore drill evidence", async () => {
    await expect(validateMigrationEvidence(await evidence("migration", "TEST", { sourceSnapshotIdentity: "snapshot", targetMigrationDatabase: "db", dryRunPassed: true, applyPassed: true, rerunPassed: true }), candidateSha)).resolves.toMatchObject({ errorCode: "MIGRATION_EVIDENCE_INCOMPLETE" });
    await expect(validateRestoreEvidence(await evidence("restore", "TEST", { sourceBackupId: "1", sourceClusterId: "source", sourceEnvironment: "TEST", targetClusterId: "target", targetEnvironment: "TEST", validationPassed: true, rtoHours: 2, rpoHours: 1 }), candidateSha)).resolves.toMatchObject({ errorCode: "RESTORE_EVIDENCE_INCOMPLETE" });
  });

  it("rejects protected=true metadata when required branch policy details are absent", () => expect(validateGithubProtection({ protected: true })).toEqual({ status: "FAIL", errorCode: "GITHUB_REQUIRED_POLICY_INCOMPLETE" }));
  it("requires allow_force_pushes to be explicitly disabled", () => { const missing: Record<string, unknown> = completeProtection(); delete missing.allow_force_pushes; expect(validateGithubProtection(completeProtection())).toEqual({ status: "PASS" }); expect(validateGithubProtection(missing)).toMatchObject({ status: "FAIL" }); });
  it("rejects a successful seven-job run bound to another SHA", () => expect(successfulCi("2".repeat(40))).toMatchObject({ status: "FAIL", errorCode: "CI_CANDIDATE_SHA_MISMATCH" }));

  it("becomes release-ready only when every production gate has verified category evidence", async () => {
    const report = buildReleaseReadiness(inputs({ ...(await completeExternalEvidence()), githubProtection: validateGithubProtection(completeProtection()), exactHeadCi: successfulCi() }), verifiedAt);
    expect(report).toMatchObject({ overall: "PASS", releaseReady: true });
  });

  it("fails closed when production evaluation runs with APP_ENV=TEST", async () => {
    const report = buildReleaseReadiness(inputs({ ...(await completeExternalEvidence()), appEnvironment: "TEST", githubProtection: validateGithubProtection(completeProtection()), exactHeadCi: successfulCi() }), verifiedAt);
    expect(report.releaseReady).toBe(false); expect(report.gates.find(({ code }) => code === "APP_ENV_VALID")).toMatchObject({ status: "FAIL", errorCode: "PRODUCTION_APP_ENV_REQUIRED" }); expect(readinessExitCode(report)).toBe(1);
  });

  it("keeps CI mode reachable with APP_ENV=TEST without declaring release readiness", () => { const report = buildReleaseReadiness(inputs({ mode: "ci", appEnvironment: "TEST" })); expect(report.releaseReady).toBe(false); expect(readinessExitCode(report)).toBe(0); });
});
