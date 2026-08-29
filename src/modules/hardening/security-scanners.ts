export type SecurityFinding = { file: string; line: number; rule: string };

const BINARY_FILE = /(?:\.(?:png|jpg|jpeg|gif|pdf|xlsx|ico|woff2?|zip|gz|7z|mp4|mov))$/i;
const SECRET_VARIABLE = /(?:^|_)(?:SECRET|SECRET_ID|SECRET_KEY|TOKEN|PASSWORD|PASSWD|API_KEY|ACCESS_KEY|PRIVATE_KEY|DATABASE_URL|CONNECTION_STRING)(?:_|$)/i;
const EXPLICIT_PLACEHOLDER = /^(?:|<[^>]+>|\$\{[^}]+\}|(?:replace|change)(?:[-_ ]?me|[-_ ]?with.*)|your[-_ ].*|x{4,}|example(?:\.invalid)?|placeholder|dummy|ci-root-password|.*not[-_ ]for[-_ ]production|mysql:\/\/(?:USER:PASSWORD|root:ci-root-password)@.*)$/i;

const SECRET_RULES: ReadonlyArray<readonly [string, RegExp]> = [
  ["PRIVATE_KEY", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["TENCENT_SECRET_ID", /\bAKID[A-Za-z0-9]{16,}\b/],
  ["GITHUB_TOKEN", /\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}\b/],
  ["BEARER_TOKEN", /\bBearer\s+[A-Za-z0-9._~+/-]{24,}=*/i],
];

export function isScannableTextFile(file: string): boolean {
  return !BINARY_FILE.test(file);
}

function unquote(value: string): string {
  const trimmed = value.trim().replace(/\s+#.*$/, "").trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1).trim();
  return trimmed;
}

export function isExplicitSecretPlaceholder(value: string): boolean {
  return EXPLICIT_PLACEHOLDER.test(unquote(value));
}

export function scanSecretText(file: string, text: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    for (const [rule, pattern] of SECRET_RULES) if (pattern.test(line)) findings.push({ file, line: index + 1, rule });
    const assignment = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*(?:=|:)\s*(.*?)\s*$/);
    if (assignment && SECRET_VARIABLE.test(assignment[1]) && !isExplicitSecretPlaceholder(assignment[2])) {
      findings.push({ file, line: index + 1, rule: "SECRET_VARIABLE_VALUE" });
    }
  }
  return findings;
}

export const DANGEROUS_CODE_RULES: ReadonlyArray<readonly [string, RegExp]> = [
  ["PRISMA_UNSAFE_RAW", /\$(?:queryRawUnsafe|executeRawUnsafe)\b/],
  ["DANGEROUS_HTML", /dangerouslySetInnerHTML\s*=/],
  ["EVAL", /\beval\s*\(/],
  ["NEW_FUNCTION", /\bnew\s+Function\s*\(/],
  ["PRODUCTION_DB_PUSH", /prisma\s+db\s+push/],
  ["RUNTIME_SCHEMA_CREATE", /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/i],
];

export function isProductionCodeOrConfig(file: string): boolean {
  const normalized = file.replaceAll("\\", "/");
  if (/^(?:src|scripts|\.github)\//.test(normalized) || /^Dockerfile(?:\.|$)/.test(normalized)) return true;
  if (normalized.includes("/")) return false;
  return /^(?:package(?:-lock)?\.json|\.npmrc|\.dockerignore|server\.(?:js|mjs|cjs)|.*\.config\.(?:js|mjs|cjs|ts|mts|cts)|tsconfig\.json|next-env\.d\.ts)$/.test(normalized);
}

const DANGEROUS_CODE_EXEMPTIONS: ReadonlyArray<{ file: string; rule: string; reason: string }> = DANGEROUS_CODE_RULES.map(([rule]) => ({
  file: "src/modules/hardening/security-scanners.ts",
  rule,
  reason: "This file contains the scanner's literal rule definitions, not production execution of the matched construct.",
}));

export function dangerousCodeExemption(file: string, rule: string): string | null {
  return DANGEROUS_CODE_EXEMPTIONS.find((item) => item.file === file.replaceAll("\\", "/") && item.rule === rule)?.reason ?? null;
}

export function scanDangerousCodeText(file: string, text: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    for (const [rule, pattern] of DANGEROUS_CODE_RULES) {
      if (pattern.test(line) && !dangerousCodeExemption(file, rule)) findings.push({ file, line: index + 1, rule });
    }
  }
  return findings;
}
