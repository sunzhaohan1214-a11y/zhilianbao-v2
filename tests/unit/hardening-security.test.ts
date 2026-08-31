import { createServer, type Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applicationSecurityHeaders } from "../../next.config";
import { redactLogValue, writeLog } from "@/lib/logging/logger";
import { ClamAvFileScanAdapter } from "@/modules/attachment/scan/file-scan-adapter";
import { isProductionCodeOrConfig, scanDangerousCodeText, scanSecretText } from "@/modules/hardening/security-scanners";
import { safeErrorMetadata } from "@/lib/logging/safe-error";

async function clamServer(response: string | null) {
  const sockets = new Set<Socket>();
  const received: Buffer[] = [];
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("data", (chunk) => received.push(chunk));
    socket.on("end", () => {
      if (response !== null) socket.end(response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("TEST_SERVER_ADDRESS_INVALID");
  return {
    port: address.port,
    received,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("M3-008 security headers and logging", () => {
  it("ships the required restrictive headers without permissive source wildcards", () => {
    const headers = new Map(applicationSecurityHeaders.map(({ key, value }) => [key, value]));
    expect(headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(headers.get("Content-Security-Policy")).not.toContain("default-src *");
    expect(headers.get("Content-Security-Policy")).not.toContain("connect-src *");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Permissions-Policy")).toContain("geolocation=()");
  });

  it("recursively redacts case-insensitive sensitive fields and circular values", () => {
    const circular: Record<string, unknown> = { Password: "raw", nested: { TOKEN: "raw", safe: "ok" } };
    circular.self = circular;
    expect(redactLogValue(circular)).toEqual({
      Password: "[REDACTED]",
      nested: { TOKEN: "[REDACTED]", safe: "ok" },
      self: "[CIRCULAR]",
    });
  });

  it("emits structured JSON without secret values", () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    writeLog("info", { module: "test", requestId: "request-1", result: "pass", secretKey: "do-not-log" });
    const payload = JSON.parse(String(output.mock.calls[0]?.[0]));
    expect(payload).toMatchObject({ level: "info", module: "test", requestId: "request-1", result: "pass", secretKey: "[REDACTED]" });
  });

  it("accepts only explicitly allowlisted application, database, and Prisma codes", () => {
    expect(safeErrorMetadata({ code: "ATTACHMENT_SCANNER_UNAVAILABLE" }))
      .toEqual({ errorCode: "ATTACHMENT_SCANNER_UNAVAILABLE", errorClass: "application" });
    expect(safeErrorMetadata({ code: "ER_CON_COUNT_ERROR" }))
      .toEqual({ errorCode: "ER_CON_COUNT_ERROR", errorClass: "database" });
    expect(safeErrorMetadata({ code: "P2024" }))
      .toEqual({ errorCode: "P2024", errorClass: "prisma" });
  });

  it.each([
    "ARBITRARY_CUSTOM_CODE",
    "PASSWORD_SECRET_SHOULD_NOT_LOG",
    "TOKEN_ATTACKER_CONTROLLED",
    "DATABASE_URL_LEAK",
  ])("rejects unknown uppercase error code %s", (code) => {
    expect(safeErrorMetadata({ code })).toEqual({ errorCode: "UNKNOWN_ERROR", errorClass: "unknown" });
  });

  it("skips an unknown outer code and finds an allowlisted inner cause", () => {
    expect(safeErrorMetadata({ code: "ATTACKER_CONTROLLED_CODE", cause: { code: "ER_CON_COUNT_ERROR" } }))
      .toEqual({ errorCode: "ER_CON_COUNT_ERROR", errorClass: "database" });
  });

  it("returns unknown for an all-unknown cause chain and terminates on cycles", () => {
    const outer: { code: string; cause?: unknown } = { code: "OUTER_UNKNOWN_CODE" };
    const inner: { code: string; cause?: unknown } = { code: "INNER_UNKNOWN_CODE", cause: outer };
    outer.cause = inner;
    expect(safeErrorMetadata(outer)).toEqual({ errorCode: "UNKNOWN_ERROR", errorClass: "unknown" });
  });

  it("logs UNKNOWN_ERROR without an unknown code or secret-bearing message", () => {
    const output = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fakeMessage = "mysql://fake-user:fake-password@db.invalid/fake 13900000000 Bearer fake-token-123456 password=fake-password";
    const safe = safeErrorMetadata(Object.assign(new Error(fakeMessage), { code: "PASSWORD_SECRET_SHOULD_NOT_LOG" }));
    writeLog("error", { module: "api", result: "unhandled_error", errorCode: safe.errorCode, errorClass: safe.errorClass });
    const serialized = String(output.mock.calls[0]?.[0]);
    expect(safe).toEqual({ errorCode: "UNKNOWN_ERROR", errorClass: "unknown" });
    expect(serialized).toContain("UNKNOWN_ERROR");
    expect(serialized).not.toContain("PASSWORD_SECRET_SHOULD_NOT_LOG");
    expect(serialized).not.toContain(fakeMessage);
    expect(serialized).not.toContain("fake-password");
    expect(serialized).not.toContain("fake-token-123456");
    expect(serialized).not.toContain("13900000000");
  });

  it("redacts sensitive substrings inside ordinary keys, arrays, and nested objects", () => {
    expect(redactLogValue({
      message: "Authorization: Bearer fake-token-123456 contact 13800138000 user@example.com",
      rows: ["mysql://root:real-password@db.internal:3306/prod", { note: "token=plain-secret-value" }],
    })).toEqual({
      message: "Authorization:[REDACTED] contact [REDACTED] [REDACTED]",
      rows: ["mysql://[REDACTED]@db.internal:3306/prod", { note: "token=[REDACTED]" }],
    });
  });

  it("rejects non-placeholder secret assignments including .env.example bypasses", () => {
    expect(scanSecretText(".env.example", "SESSION_SECRET=real-production-secret-value")).toEqual([
      { file: ".env.example", line: 1, rule: "SECRET_VARIABLE_VALUE" },
    ]);
    expect(scanSecretText(".env.example", "SESSION_SECRET=replace-with-a-long-random-secret\nDATABASE_URL=mysql://USER:PASSWORD@HOST:3306/example")).toEqual([]);
  });

  it("scans production root config and blocks dangerous constructs there", () => {
    expect(isProductionCodeOrConfig("next.config.ts")).toBe(true);
    expect(scanDangerousCodeText("next.config.ts", "const factory = eval(config.source)")).toEqual([
      { file: "next.config.ts", line: 1, rule: "EVAL" },
    ]);
  });
});

describe("M3-008 ClamAV INSTREAM adapter", () => {
  it("streams length-prefixed bytes and accepts a clean response", async () => {
    const fake = await clamServer("stream: OK\0");
    try {
      const scanner = new ClamAvFileScanAdapter({ host: "127.0.0.1", port: fake.port, timeoutMs: 1_000 });
      await expect(scanner.scan({ content: Buffer.from("clean-test-content"), filename: "ignored.pdf", detectedMimeType: "application/pdf" }))
        .resolves.toEqual({ clean: true, engine: "clamav" });
      const wire = Buffer.concat(fake.received);
      expect(wire.subarray(0, 10).toString()).toBe("zINSTREAM\0");
      expect(wire.readUInt32BE(10)).toBe(Buffer.byteLength("clean-test-content"));
      expect(wire.subarray(-4)).toEqual(Buffer.alloc(4));
    } finally { await fake.close(); }
  });

  it("returns a bounded malware signature", async () => {
    const fake = await clamServer("stream: Test.Signature FOUND\0");
    try {
      const scanner = new ClamAvFileScanAdapter({ host: "127.0.0.1", port: fake.port, timeoutMs: 1_000 });
      await expect(scanner.scan({ content: Buffer.from("malware-test-marker"), filename: "ignored", detectedMimeType: "application/octet-stream" }))
        .resolves.toEqual({ clean: false, engine: "clamav", signature: "Test.Signature" });
    } finally { await fake.close(); }
  });

  it("fails closed on bad protocol and timeout", async () => {
    const invalid = await clamServer("unexpected response\0");
    try {
      const scanner = new ClamAvFileScanAdapter({ host: "127.0.0.1", port: invalid.port, timeoutMs: 1_000 });
      await expect(scanner.scan({ content: Buffer.from("x"), filename: "x", detectedMimeType: "text/plain" }))
        .rejects.toThrow("CLAMAV_PROTOCOL_INVALID");
    } finally { await invalid.close(); }

    const stalled = await clamServer(null);
    try {
      const scanner = new ClamAvFileScanAdapter({ host: "127.0.0.1", port: stalled.port, timeoutMs: 100 });
      await expect(scanner.scan({ content: Buffer.from("x"), filename: "x", detectedMimeType: "text/plain" }))
        .rejects.toThrow("CLAMAV_TIMEOUT");
    } finally { await stalled.close(); }
  });
});
