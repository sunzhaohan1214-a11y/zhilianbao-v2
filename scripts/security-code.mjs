import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isProductionCodeOrConfig, scanDangerousCodeText } from "../src/modules/hardening/security-scanners.ts";

const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" }).split("\0").filter((file) => file && isProductionCodeOrConfig(file));
const findings = [];
for (const file of files) {
  let text;
  try { text = readFileSync(file, "utf8"); } catch { continue; }
  findings.push(...scanDangerousCodeText(file, text));
}
if (findings.length) {
  for (const finding of findings) console.error(`${finding.file}:${finding.line} ${finding.rule}`);
  process.exitCode = 1;
} else console.log("Dangerous-code scan passed");
