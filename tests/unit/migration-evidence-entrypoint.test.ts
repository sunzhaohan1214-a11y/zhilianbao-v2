import { describe, expect, it } from "vitest";
import { validateMigrationEvidence as publicValidator } from "../../src/modules/hardening/release-readiness.ts";
import { validateMigrationEvidence as targetBindingValidator } from "../../src/modules/hardening/migration-evidence-target-binding.ts";
import { validateMigrationEvidence as baseValidator } from "../../src/modules/hardening/migration-evidence.ts";

describe("migration evidence public entrypoint", () => {
  it("cannot bypass target-state binding through the base validator", () => {
    expect(publicValidator).toBe(targetBindingValidator);
    expect(publicValidator).toBe(baseValidator);
  });
});
