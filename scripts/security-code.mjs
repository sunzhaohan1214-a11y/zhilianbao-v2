import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "src", "scripts", ".github", "Dockerfile"], { encoding: "utf8" }).split("\0").filter((file) => file && file !== "scripts/security-code.mjs");
const rules = [
  ["PRISMA_UNSAFE_RAW", /\$(?:queryRawUnsafe|executeRawUnsafe)\b/],
  ["DANGEROUS_HTML", /dangerouslySetInnerHTML\s*=/],
  ["EVAL", /\beval\s*\(/],
  ["NEW_FUNCTION", /\bnew\s+Function\s*\(/],
  ["PRODUCTION_DB_PUSH", /prisma\s+db\s+push/],
  ["RUNTIME_SCHEMA_CREATE", /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/i],
];
const findings = [];
for (const file of files) {
  let text;
  try { text = readFileSync(file, "utf8"); } catch { continue; }
  for (const [index, line] of text.split(/\r?\n/).entries()) for (const [rule, pattern] of rules) if (pattern.test(line)) findings.push({ file, line: index + 1, rule });
}
if (findings.length) {
  for (const finding of findings) console.error(`${finding.file}:${finding.line} ${finding.rule}`);
  process.exitCode = 1;
} else console.log("Dangerous-code scan passed");
