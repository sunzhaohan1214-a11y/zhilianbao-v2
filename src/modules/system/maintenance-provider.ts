import type { ProviderHealth } from "./backup-provider"; import { fakeSystemProvidersEnabled } from "./runtime";
export type MaintenanceStatus = { active: boolean; operationId?: string; completedOperationId?: string };
export interface MaintenanceProvider { health(): Promise<ProviderHealth>; status(): Promise<MaintenanceStatus>; enter(input: { operationId: string; reason: string }): Promise<void>; exit(operationId: string): Promise<void>; }
export class UnavailableMaintenanceProvider implements MaintenanceProvider { async health(): Promise<ProviderHealth> { return { ready: false, status: "NOT_CONFIGURED", provider: "unavailable-maintenance", detail: "未配置部署层持久写锁" }; } async status() { return { active: false }; } async enter(): Promise<never> { throw new Error("RESTORE_MAINTENANCE_UNAVAILABLE"); } async exit(): Promise<never> { throw new Error("RESTORE_MAINTENANCE_UNAVAILABLE"); } }
export class FakeMaintenanceProvider implements MaintenanceProvider {
  private current: string | undefined; private completed: string | undefined;
  constructor(private readonly beforeExit?: () => void | Promise<void>) {}
  async health(): Promise<ProviderHealth> { return { ready: true, status: "READY", provider: "fake-maintenance" }; }
  async status() { return { active: Boolean(this.current), operationId: this.current, completedOperationId: this.completed }; }
  async enter(input: { operationId: string; reason: string }) { if (this.current && this.current !== input.operationId) throw new Error("MAINTENANCE_ALREADY_ACTIVE"); if (this.completed === input.operationId) throw new Error("MAINTENANCE_OPERATION_ALREADY_COMPLETED"); this.current = input.operationId; }
  async exit(operationId: string) { if (!this.current && this.completed === operationId) return; if (this.current !== operationId) throw new Error("MAINTENANCE_OPERATION_MISMATCH"); await this.beforeExit?.(); this.current = undefined; this.completed = operationId; }
}
const runtime = globalThis as typeof globalThis & { __zlbMaintenanceProvider?: MaintenanceProvider };
export function getMaintenanceProvider(): MaintenanceProvider { runtime.__zlbMaintenanceProvider ??= fakeSystemProvidersEnabled() ? new FakeMaintenanceProvider() : new UnavailableMaintenanceProvider(); return runtime.__zlbMaintenanceProvider; }
