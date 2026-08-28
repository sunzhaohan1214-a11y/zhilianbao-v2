import { AIError } from "./errors";
import type { DemandMatchProvider, DemandMatchProviderRequest } from "./demand-match";

export class DisabledDemandMatchProvider implements DemandMatchProvider {
  readonly provider = "disabled";
  readonly model = "unconfigured";

  async rank(): Promise<never> {
    throw new AIError("AI_PROVIDER_UNAVAILABLE", "Demand match provider is not configured");
  }
}

export class FakeDemandMatchProvider implements DemandMatchProvider {
  readonly provider = "fake";
  readonly model = "fake-demand-match-v1";
  readonly requests: DemandMatchProviderRequest[] = [];

  constructor(private readonly outputs: unknown[] | ((request: DemandMatchProviderRequest) => unknown | Promise<unknown>)) {}

  async rank(request: DemandMatchProviderRequest): Promise<unknown> {
    this.requests.push(structuredClone(request));
    if (typeof this.outputs === "function") return this.outputs(request);
    if (this.outputs.length === 0) throw new AIError("AI_PROVIDER_UNAVAILABLE", "Fake provider has no configured output");
    const output = this.outputs.shift();
    if (output instanceof Error) throw output;
    return output;
  }
}

