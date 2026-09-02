import { describe, expect, it } from "vitest";
import { validateTestUatEnvironment, type TestUatAccountsInput } from "@/operations/test-uat-accounts";

const input: TestUatAccountsInput = {
  expectedAppVersion: "a".repeat(40), apply: false,
  operatorAccountId: "00000000-0000-4000-8000-000000000001",
  phones: {
    superAdmin: "19900000101", admin: "19900000102", groupLeader: "19900000103",
    minister: "19900000104", memberCurrent: "19900000105", townshipStaff: "19900000106",
    departmentStaff: "19900000107", leaderStage2: "19900000108", memberAlumni: "19900000109",
  },
};

describe("TEST UAT account preparation guard", () => {
  it("allows a matching TEST candidate plan", () => {
    expect(() => validateTestUatEnvironment({ APP_ENV: "test", APP_VERSION: "a".repeat(40) }, input)).not.toThrow();
  });

  it("rejects production, drift and unconfirmed writes", () => {
    expect(() => validateTestUatEnvironment({ APP_ENV: "production", APP_VERSION: "a".repeat(40) }, input)).toThrow("TEST_UAT_ENVIRONMENT_FORBIDDEN");
    expect(() => validateTestUatEnvironment({ APP_ENV: "test", APP_VERSION: "b".repeat(40) }, input)).toThrow("TEST_UAT_APP_VERSION_MISMATCH");
    expect(() => validateTestUatEnvironment({ APP_ENV: "test", APP_VERSION: "a".repeat(40) }, { ...input, apply: true })).toThrow("TEST_UAT_CONFIRMATION_REQUIRED");
  });
});
