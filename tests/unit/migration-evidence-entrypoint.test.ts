import { describe, expect, it } from "vitest";
import { validateMigrationEvidence as publicValidator } from "../../src/modules/hardening/release-readiness.ts";
import { validateMigrationEvidence as hardenedValidator } from "../../src/modules/hardening/migration-evidence.ts";
import { validateMigrationEvidence as compatibilityCoreValidator } from "../../src/modules/hardening/release-readiness-core.ts";

describe("migration evidence public entrypoint", () => {
  it("exports the hardened validator used by the release script", () => {
    expect(publicValidator).toBe(hardenedValidator);
    expect(publicValidator).not.toBe(compatibilityCoreValidator);
  });
});
