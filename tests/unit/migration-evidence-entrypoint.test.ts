import { describe, expect, it } from "vitest";
import { validateMigrationEvidence as publicValidator } from "../../src/modules/hardening/release-readiness.ts";
import { validateMigrationEvidence as targetBindingValidator } from "../../src/modules/hardening/migration-evidence-target-binding.ts";
import { validateMigrationEvidence as baseValidator } from "../../src/modules/hardening/migration-evidence.ts";

describe("migration evidence public entrypoint", () => {
  it("exports the target-state-bound validator used by the release script", () => {
    expect(publicValidator).toBe(targetBindingValidator);
    expect(publicValidator).not.toBe(baseValidator);
  });
});
