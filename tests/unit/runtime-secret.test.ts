import { describe, expect, it } from "vitest";
import { applyRuntimeSecret, loadRuntimeSecret, parseRuntimeSecret, RUNTIME_SECRET_KEYS } from "@/runtime/runtime-secret";

const values = {
  "DATABASE_URL": "mysql://runtime.invalid/database",
  "AUTH_RATE_LIMIT_SECRET": "rate-limit-secret",
  "COS_SECRET_ID": "cos-secret-id",
  "COS_SECRET_KEY": "cos-secret-key",
};

describe("runtime secret bootstrap", () => {
  it("accepts only the complete allowlisted secret object", () => {
    expect(parseRuntimeSecret(JSON.stringify(values))).toEqual(values);
    expect(() => parseRuntimeSecret(JSON.stringify({ ...values, EXTRA: "no" }))).toThrow("RUNTIME_SECRET_UNKNOWN_KEY");
    expect(() => parseRuntimeSecret(JSON.stringify({ ...values, COS_SECRET_KEY: "" }))).toThrow("RUNTIME_SECRET_COS_SECRET_KEY_REQUIRED");
  });

  it("hydrates only the allowlisted environment keys", () => {
    const environment: NodeJS.ProcessEnv = { NODE_ENV: "test", KEEP: "unchanged" };
    applyRuntimeSecret(environment, values);
    expect(environment.KEEP).toBe("unchanged");
    expect(Object.fromEntries(RUNTIME_SECRET_KEYS.map((key) => [key, environment[key]]))).toEqual(values);
  });

  it("uses the explicitly pinned SSM version without exposing the response", async () => {
    const environment: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      "ZLB_RUNTIME_SECRET_NAME": "zhilianbao-v2-test-runtime",
      "ZLB_RUNTIME_SECRET_REGION": "ap-shanghai",
      "ZLB_RUNTIME_SECRET_VERSION": "v2",
    };
    const calls: unknown[] = [];
    await loadRuntimeSecret(environment, {
      async GetSecretValue(input) {
        calls.push(input);
        return { SecretString: JSON.stringify(values) };
      },
    });
    expect(calls).toEqual([{ SecretName: "zhilianbao-v2-test-runtime", VersionId: "v2" }]);
    expect(environment.DATABASE_URL).toBe(values.DATABASE_URL);
  });

  it("fails closed when the SSM version is missing or invalid", async () => {
    const environment: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      "ZLB_RUNTIME_SECRET_NAME": "zhilianbao-v2-test-runtime",
      "ZLB_RUNTIME_SECRET_REGION": "ap-shanghai",
    };
    await expect(loadRuntimeSecret(environment, { GetSecretValue: async () => ({}) }))
      .rejects.toThrow("RUNTIME_SECRET_VERSION_REQUIRED");
    environment.ZLB_RUNTIME_SECRET_VERSION = "../v2";
    await expect(loadRuntimeSecret(environment, { GetSecretValue: async () => ({}) }))
      .rejects.toThrow("RUNTIME_SECRET_VERSION_INVALID");
  });
});
