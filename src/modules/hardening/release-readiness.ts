export const READINESS_STATUSES = [
  "PASS", "FAIL", "BLOCKED_BY_EXTERNAL_ENV", "BLOCKED_BY_SOURCE_DATA", "BLOCKED_BY_UAT", "NOT_APPLICABLE",
] as const;
export type ReadinessStatus = typeof READINESS_STATUSES[number];
export type ReadinessCategory = "code" | "ci" | "security" | "performance" | "browser" | "weakNetwork" | "attachments" | "ai" | "backup" | "restore" | "migration" | "github" | "uat" | "production";
export type ReadinessGate = {
  code: string;
  category: ReadinessCategory;
  status: ReadinessStatus;
  requiredForProduction: boolean;
  codeReachable: boolean;
  configured?: boolean;
  provider?: string;
  version?: string;
  errorCode?: string;
};

export type ReleaseReadinessReport = {
  version: "m3-008-v1";
  mode: "local" | "ci" | "prod";
  timestamp: string;
  overall: ReadinessStatus;
  releaseReady: boolean;
  gates: ReadinessGate[];
};

export function summarizeReadiness(input: Omit<ReleaseReadinessReport, "overall" | "releaseReady">): ReleaseReadinessReport {
  const productionBlocker = input.gates.some((gate) => gate.requiredForProduction && gate.status !== "PASS" && gate.status !== "NOT_APPLICABLE");
  const codeFailure = input.gates.some((gate) => gate.codeReachable && gate.status === "FAIL");
  const status: ReadinessStatus = codeFailure || input.gates.some((gate) => gate.status === "FAIL")
    ? "FAIL"
    : productionBlocker
      ? input.gates.find((gate) => gate.requiredForProduction && gate.status.startsWith("BLOCKED_"))?.status ?? "FAIL"
      : "PASS";
  return { ...input, overall: status, releaseReady: !productionBlocker };
}

export function readinessExitCode(report: ReleaseReadinessReport): number {
  if (report.mode === "prod") return report.releaseReady ? 0 : 1;
  return report.gates.some((gate) => gate.codeReachable && gate.status === "FAIL") ? 1 : 0;
}
