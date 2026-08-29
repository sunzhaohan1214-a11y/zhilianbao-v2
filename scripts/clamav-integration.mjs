import { ClamAvFileScanAdapter } from "../src/modules/attachment/scan/file-scan-adapter.ts";

const host = process.env.CLAMAV_HOST ?? "127.0.0.1";
const port = Number(process.env.CLAMAV_PORT ?? 3310);
const scanner = new ClamAvFileScanAdapter({ host, port, timeoutMs: Number(process.env.CLAMAV_TIMEOUT_MS ?? 5_000) });
const harmless = Buffer.from("M3-008 real ClamAV clean integration probe");
// Construct the standard antivirus test marker at runtime so repository scanners do not treat it as a committed sample file.
const marker = ["X5O!P%@AP[4\\PZX54(P^)", "7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"].join("");

async function scanWithStartupRetry(content) {
  let last;
  for (let attempt = 0; attempt < 45; attempt += 1) {
    try { return await scanner.scan({ content, filename: "probe.bin", detectedMimeType: "application/octet-stream" }); }
    catch (error) {
      last = error;
      if (attempt < 44) await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  throw last;
}

const clean = await scanWithStartupRetry(harmless);
if (!clean.clean || clean.engine !== "clamav") throw new Error("CLAMAV_REAL_CLEAN_PROBE_FAILED");
const malware = await scanner.scan({ content: Buffer.from(marker), filename: "probe.bin", detectedMimeType: "application/octet-stream" });
if (malware.clean || malware.engine !== "clamav" || !malware.signature) throw new Error("CLAMAV_REAL_MALWARE_PROBE_FAILED");
console.log(JSON.stringify({ status: "PASS", provider: "clamav", cleanProbe: true, malwareBlocked: true, signatureRecorded: true }));
