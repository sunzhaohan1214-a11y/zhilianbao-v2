import { createServer, type Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applicationSecurityHeaders } from "../../next.config";
import { redactLogValue, writeLog } from "@/lib/logging/logger";
import { ClamAvFileScanAdapter } from "@/modules/attachment/scan/file-scan-adapter";

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
