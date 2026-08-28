import { DemandRecommendationService } from "@/modules/demand/demand-recommendation-service";
import { PermanentJobError } from "../errors";
import type { JobHandler } from "../handler-registry";

export class DemandRecommendationJobHandler implements JobHandler<"DEMAND_RECOMMENDATION_RUN"> {
  constructor(private readonly service = new DemandRecommendationService()) {}

  async handle(payload: { runId: string }): Promise<void> {
    try {
      await this.service.executeRun(payload.runId);
    } catch (error) {
      throw new PermanentJobError("DEMAND_RECOMMENDATION_FAILED", "Demand recommendation run failed", { cause: error });
    }
  }
}
