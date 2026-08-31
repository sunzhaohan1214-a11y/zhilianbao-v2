export type MigrationExecutionMode = "DRY_RUN" | "APPLY";
export type MigrationEnvironment = "LOCAL" | "TEST" | "PROD" | "UNKNOWN";

export function normalizeMigrationEnvironment(appEnvironment: string | undefined): MigrationEnvironment {
  const value = appEnvironment?.trim().toLowerCase() ?? "";
  if (["local", "development", "dev"].includes(value)) return "LOCAL";
  if (["test", "testing", "uat", "staging"].includes(value)) return "TEST";
  if (["prod", "production"].includes(value)) return "PROD";
  return "UNKNOWN";
}

export function assertMigrationEnvironmentAllowed(
  appEnvironment: string | undefined,
  mode: MigrationExecutionMode,
): Exclude<MigrationEnvironment, "PROD"> {
  const environment = normalizeMigrationEnvironment(appEnvironment);
  if (environment === "PROD") throw new Error("MIGRATION_PRODUCTION_REFUSED");
  if (mode === "APPLY" && environment === "UNKNOWN") throw new Error("MIGRATION_APPLY_ENVIRONMENT_REQUIRED");
  return environment;
}
