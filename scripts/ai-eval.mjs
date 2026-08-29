import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { AI_EVAL_DATASET_HASH, AI_EVAL_DATASET_VERSION } from "../src/modules/ai/evaluation/config-binding.ts";
import { planChatQuery } from "../src/modules/ai/chat/query-planner.ts";

const mode = process.argv.find((arg) => arg.startsWith("--mode="))?.split("=")[1] ?? "contract";
const bytes = await readFile("evals/ai/contract-v1.json");
const datasetHash = createHash("sha256").update(bytes).digest("hex");
if (datasetHash !== AI_EVAL_DATASET_HASH) throw new Error("AI_EVAL_DATASET_HASH_MISMATCH");
const dataset = JSON.parse(bytes.toString("utf8"));
if (dataset.version !== AI_EVAL_DATASET_VERSION) throw new Error("AI_EVAL_DATASET_VERSION_MISMATCH");
await mkdir("artifacts", { recursive: true });

if (mode === "provider") {
  const report = { version: dataset.version, datasetHash, capability: dataset.capability, provider: "unconfigured", sampleCount: dataset.cases.length, estimatedCalls: dataset.cases.length, status: "BLOCKED_BY_EXTERNAL_ENV", errorCode: "REAL_AI_PROVIDER_ADAPTER_NOT_CONFIGURED", timestamp: new Date().toISOString() };
  await writeFile("artifacts/ai-eval-report.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
} else if (mode === "contract") {
  const results = dataset.cases.map((item) => {
    const plan = planChatQuery(item.prompt);
    const actual = plan.intent === "PRIVATE_FORBIDDEN" ? "REFUSE_PRIVATE" : plan.intent === "UNKNOWN" ? "NO_RELIABLE_INFORMATION" : `STRUCTURED_${plan.intent}`;
    return { id: item.id, category: item.category, passed: actual === item.expected };
  });
  const permission = results.filter((item) => item.category === "permission");
  const grounding = results.filter((item) => item.category === "grounding");
  const report = { version: dataset.version, datasetHash, capability: dataset.capability, provider: "deterministic-contract", sampleCount: results.length, permissionNoLeakRate: permission.filter((item) => item.passed).length / permission.length, fakeFormalFactCount: grounding.filter((item) => !item.passed).length, passed: results.every((item) => item.passed), results, timestamp: new Date().toISOString(), provesRealProviderQuality: false };
  await writeFile("artifacts/ai-eval-contract-report.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.passed ? "PASS" : "FAIL", sampleCount: report.sampleCount, permissionNoLeakRate: report.permissionNoLeakRate, fakeFormalFactCount: report.fakeFormalFactCount, provesRealProviderQuality: false }));
  if (!report.passed) process.exitCode = 1;
} else throw new Error("AI_EVAL_MODE_INVALID");
