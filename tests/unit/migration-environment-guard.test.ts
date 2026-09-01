import { describe, expect, it } from "vitest";
import { assertMigrationEnvironmentAllowed, normalizeMigrationEnvironment } from "@/modules/migration/environment-guard";

describe("migration execution environment guard", () => {
  it.each([
    ["prod", "PROD"], ["PROD", "PROD"], ["production", "PROD"], ["PRODUCTION", "PROD"],
    [" local ", "LOCAL"], ["development", "LOCAL"], ["DEV", "LOCAL"],
    ["test", "TEST"], ["TEST", "TEST"], ["testing", "TEST"], ["uat", "TEST"], ["staging", "TEST"],
    [undefined, "UNKNOWN"], ["", "UNKNOWN"], ["qa", "UNKNOWN"],
  ] as const)("normalizes APP_ENV=%s to %s", (value, expected) => {
    expect(normalizeMigrationEnvironment(value)).toBe(expected);
  });

  it.each(["prod", "PROD", "production", "PRODUCTION"])("refuses production alias %s in every mode", (value) => {
    expect(() => assertMigrationEnvironmentAllowed(value, "DRY_RUN")).toThrow("MIGRATION_PRODUCTION_REFUSED");
    expect(() => assertMigrationEnvironmentAllowed(value, "APPLY")).toThrow("MIGRATION_PRODUCTION_REFUSED");
  });

  it.each(["local", "LOCAL", "development", "dev", "test", "TEST", "testing", "uat", "staging"])("allows explicit non-production apply environment %s", (value) => {
    expect(() => assertMigrationEnvironmentAllowed(value, "APPLY")).not.toThrow();
  });

  it.each([undefined, "", "   ", "qa", "sandbox"])("fails closed for unknown apply environment %s", (value) => {
    expect(() => assertMigrationEnvironmentAllowed(value, "APPLY")).toThrow("MIGRATION_APPLY_ENVIRONMENT_REQUIRED");
  });

  it.each([undefined, "", "qa"])("keeps non-production dry-run available when APP_ENV is %s", (value) => {
    expect(assertMigrationEnvironmentAllowed(value, "DRY_RUN")).toBe("UNKNOWN");
  });
});
