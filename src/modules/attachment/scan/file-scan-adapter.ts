import { connect, type Socket } from "node:net";

export type FileScanResult = {
  clean: boolean;
  engine: string;
  signature?: string;
};

export interface FileScanAdapter {
  scan(input: { content: Buffer; filename: string; detectedMimeType: string }): Promise<FileScanResult>;
}

export class UnavailableFileScanAdapter implements FileScanAdapter {
  async scan(): Promise<FileScanResult> {
    throw new Error("FILE_SCANNER_UNAVAILABLE");
  }
}

export class FakeCleanScanner implements FileScanAdapter {
  async scan(): Promise<FileScanResult> {
    return { clean: true, engine: "fake-clean" };
  }
}

export class FakeMalwareScanner implements FileScanAdapter {
  constructor(private readonly signature = "TEST-MALWARE") {}

  async scan(): Promise<FileScanResult> {
    return { clean: false, engine: "fake-malware", signature: this.signature };
  }
}

export type ClamAvFileScanConfig = { host: string; port: number; timeoutMs: number };

function parseClamAvResponse(value: string): FileScanResult {
  const response = value.replaceAll("\0", "").trim();
  if (/^(?:stream|[\w.-]+): OK$/i.test(response)) return { clean: true, engine: "clamav" };
  const found = /^(?:stream|[\w.-]+): (.+) FOUND$/i.exec(response);
  if (found?.[1]) return { clean: false, engine: "clamav", signature: found[1].slice(0, 200) };
  throw new Error("CLAMAV_PROTOCOL_INVALID");
}

export class ClamAvFileScanAdapter implements FileScanAdapter {
  constructor(private readonly config: ClamAvFileScanConfig) {
    if (!config.host.trim() || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535 || config.timeoutMs < 100) {
      throw new Error("CLAMAV_CONFIG_INVALID");
    }
  }

  async scan(input: { content: Buffer; filename: string; detectedMimeType: string }): Promise<FileScanResult> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let response = "";
      const socket: Socket = connect({ host: this.config.host, port: this.config.port });
      const finish = (error?: unknown, result?: FileScanResult) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (error) reject(error);
        else resolve(result!);
      };
      socket.setTimeout(this.config.timeoutMs, () => finish(new Error("CLAMAV_TIMEOUT")));
      socket.on("error", (error) => finish(error));
      socket.on("connect", () => {
        socket.write("zINSTREAM\0");
        for (let offset = 0; offset < input.content.length; offset += 64 * 1024) {
          const chunk = input.content.subarray(offset, Math.min(input.content.length, offset + 64 * 1024));
          const length = Buffer.allocUnsafe(4);
          length.writeUInt32BE(chunk.length);
          socket.write(length);
          socket.write(chunk);
        }
        socket.end(Buffer.alloc(4));
      });
      socket.on("data", (chunk: Buffer) => {
        response += chunk.toString("utf8");
        if (response.length > 4096) return finish(new Error("CLAMAV_RESPONSE_TOO_LARGE"));
        if (response.includes("\0") || response.includes("\n")) {
          try { finish(undefined, parseClamAvResponse(response)); }
          catch (error) { finish(error); }
        }
      });
      socket.on("end", () => {
        if (settled) return;
        try { finish(undefined, parseClamAvResponse(response)); }
        catch (error) { finish(error); }
      });
    });
  }
}
