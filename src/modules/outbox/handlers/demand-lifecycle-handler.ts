import type { OutboxHandler } from "../outbox-handler-registry";
import type { OutboxEventType } from "../outbox-types";

export class DemandLifecycleOutboxHandler<T extends OutboxEventType> implements OutboxHandler<T> {
  async handle(): Promise<void> {
    // M1-002 establishes the durable lifecycle event boundary. Message/Todo consumers
    // are added only by the milestone that owns those workflows.
  }
}
