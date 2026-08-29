import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" }).split("\0").filter(Boolean);
const rules = [
  ["PRIVATE_KEY", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["TENCENT_SECRET_ID", /\bAKID[A-Za-z0-9]{16,}\b/],
  ["GITHUB_TOKEN", /\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}\b/],
  ["BEARER_TOKEN", /\bBearer\s+[A-Za-z0-9._~+/-]{24,}=*/i],
  ["DATABASE_URL_VALUE", /^\s*DATABASE_URL\s*=\s*(?!mysql:\/\/(?:USER:PASSWORD|root:ci-root-password)@)(?!.*(?:example\.invalid|XXXXXXXX))["']?\S+/i],
];
const findings = [];
for (const file of files) {
  if (file === ".env.example" || /(?:package-lock\.json|\.(?:png|jpg|jpeg|gif|pdf|xlsx|ico|woff2?))$/i.test(file)) continue;
  let text;
  try { text = readFileSync(file, "utf8"); } catch { continue; }
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    for (const [rule, pattern] of rules) if (pattern.test(line)) findings.push({ file, line: index + 1, rule });
  }
}
if (findings.length) {
  for (const finding of findings) console.error(`${finding.file}:${finding.line} ${finding.rule}`);
  process.exitCode = 1;
} else console.log("Secret scan passed");
