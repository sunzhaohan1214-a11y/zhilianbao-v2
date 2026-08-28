import { ZodError } from "zod";
import { DEMAND_MATCH_PROMPT_V1 } from "@/ai/prompts/demand-match/v1";
import { AIError } from "./errors";
import {
  validateDemandMatchOutput,
  type DemandMatchInput,
  type DemandMatchOutput,
  type DemandMatchProvider,
} from "./demand-match";
import { DisabledDemandMatchProvider } from "./providers";

export type DemandMatchServiceResult =
  | { ok: true; output: DemandMatchOutput; repaired: boolean; provider: string; model: string; promptVersion: string; durationMs: number }
  | { ok: false; errorCategory: string; provider: string; model: string; promptVersion: string; durationMs: number };

function safeValidationIssue(error: unknown): string {
  if (error instanceof ZodError) return error.issues.map(({ message }) => message).join("; ").slice(0, 300);
  return "invalid structured output";
}

function errorCategory(error: unknown): string {
  if (error instanceof AIError) return error.code;
  if (error instanceof ZodError) return "AI_OUTPUT_INVALID";
  return "AI_PROVIDER_UNAVAILABLE";
}

export class AIService {
  constructor(private readonly demandMatchProvider: DemandMatchProvider = new DisabledDemandMatchProvider()) {}

  async rankDemandCandidates(input: DemandMatchInput): Promise<DemandMatchServiceResult> {
    const started = Date.now();
    const metadata = {
      provider: this.demandMatchProvider.provider,
      model: this.demandMatchProvider.model,
      promptVersion: DEMAND_MATCH_PROMPT_V1.version,
    };
    try {
      const first = await this.demandMatchProvider.rank({
        promptVersion: DEMAND_MATCH_PROMPT_V1.version,
        input,
        attempt: "INITIAL",
      });
      try {
        return { ok: true, output: validateDemandMatchOutput(input, first), repaired: false, ...metadata, durationMs: Date.now() - started };
      } catch (firstError) {
        const repaired = await this.demandMatchProvider.rank({
          promptVersion: DEMAND_MATCH_PROMPT_V1.version,
          input,
          attempt: "REPAIR",
          validationIssue: safeValidationIssue(firstError),
        });
        return { ok: true, output: validateDemandMatchOutput(input, repaired), repaired: true, ...metadata, durationMs: Date.now() - started };
      }
    } catch (error) {
      return { ok: false, errorCategory: errorCategory(error), ...metadata, durationMs: Date.now() - started };
    }
  }
}

