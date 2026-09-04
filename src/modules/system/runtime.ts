import { testOnlyProviderRuntimeAllowed } from "@/runtime/zero-extra-cost-policy";

export const CURRENT_SCHEMA_VERSION = "20260901140000_m3_system_admin";
export type RuntimeEnvironment = "LOCAL" | "TEST" | "PROD" | "UNKNOWN";
type RuntimeEnv = Record<string, string | undefined>;
export function currentRuntimeEnvironment(environment: RuntimeEnv = process.env): RuntimeEnvironment {
  const value = (environment.APP_ENV ?? environment.NODE_ENV ?? "").trim().toLowerCase();
  if (["local", "development", "dev"].includes(value)) return "LOCAL";
  if (["test", "testing", "uat", "staging"].includes(value)) return "TEST";
  if (["prod", "production"].includes(value)) return "PROD";
  return "UNKNOWN";
}
export function currentAppVersion(environment: RuntimeEnv = process.env): string { return environment.APP_VERSION ?? environment.VERCEL_GIT_COMMIT_SHA?.slice(0, 40) ?? "UNKNOWN"; }
export function fakeSystemProvidersEnabled(environment: RuntimeEnv = process.env): boolean {
  return environment.ENABLE_FAKE_SYSTEM_PROVIDERS === "true" && testOnlyProviderRuntimeAllowed(environment);
}
