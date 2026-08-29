import { createHash } from "node:crypto";

export const AI_EVAL_DATASET_VERSION = "m3-008-contract-v1";
export const AI_EVAL_DATASET_HASH = "1191fd53278e968e30d3e5b946cca303e832b895790d3b1e2ac30ae2e7d6ed98";
export const AI_EVAL_PROMPT_VERSION = "chat-structured-v1";

type EvaluationConfig = {
  capability: string;
  provider: string;
  model: string;
  retentionPolicy: string;
  maxRetentionDays: number | null;
  trainingOptOut: boolean;
  version: number;
};

export function configEvaluationVersion(config: EvaluationConfig): string {
  const fingerprint = createHash("sha256").update(JSON.stringify({
    datasetHash: AI_EVAL_DATASET_HASH,
    promptVersion: AI_EVAL_PROMPT_VERSION,
    capability: config.capability,
    provider: config.provider,
    model: config.model,
    retentionPolicy: config.retentionPolicy,
    maxRetentionDays: config.maxRetentionDays,
    trainingOptOut: config.trainingOptOut,
    configVersion: config.version,
  })).digest("hex");
  return `eval-${AI_EVAL_DATASET_HASH.slice(0, 12)}-${fingerprint.slice(0, 32)}`;
}
