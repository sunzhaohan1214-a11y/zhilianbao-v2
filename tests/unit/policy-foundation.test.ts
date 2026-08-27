import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { resolveCapabilities } from "@/modules/permissions";
import { FakePolicyExtractionAdapter, policyListQuerySchema, policyInterpretationSchema } from "@/modules/policy";
import { PolicyRepository } from "@/modules/policy/repository/policy-repository";

describe("M2-006 policy foundation", () => {
  it("grants governance only to admin roles", () => {
    const member = resolveCapabilities(["MEMBER_CURRENT"], new Set());
    const minister = resolveCapabilities(["MINISTER"], new Set());
    const admin = resolveCapabilities(["ADMIN"], new Set());
    expect(member.has("policy.view")).toBe(true);
    expect(minister.has("policy.view")).toBe(true);
    for (const capability of ["policy.create", "policy.edit", "policy.publish", "policy.withdraw", "policy.replacement.manage"] as const) {
      expect(member.has(capability)).toBe(false); expect(minister.has(capability)).toBe(false); expect(admin.has(capability)).toBe(true);
    }
  });

  it("normalizes list filters and rejects unbounded input", () => {
    expect(policyListQuerySchema.parse({ keyword: "  科技  ", effectStatus: "CURRENT" })).toMatchObject({ keyword: "科技", effectStatus: "CURRENT", page: 1, pageSize: 20 });
    expect(() => policyListQuerySchema.parse({ pageSize: "101" })).toThrow();
    expect(() => policyListQuerySchema.parse({ publicationStatus: "EXPIRED" })).toThrow();
  });

  it("requires a complete interpretation and evidence structure", () => {
    expect(policyInterpretationSchema.parse({ targetAudience: "企业", supportContent: "奖励", applicationConditions: "依法经营", keyClauses: ["条款一"], evidence: [{ field: "支持内容", value: "奖励", page: 2 }] })).toMatchObject({ targetAudience: "企业" });
    expect(() => policyInterpretationSchema.parse({ targetAudience: "企业", supportContent: "奖励", applicationConditions: "条件", keyClauses: [] })).toThrow();
  });

  it("keeps fake extraction provider-agnostic and candidate-only", async () => {
    const result = await new FakePolicyExtractionAdapter().extract({ policyId: "p", versionId: "v", attachmentIds: ["a"] });
    expect(result.provider).toBe("fake"); expect(result.extracted).toHaveProperty("targetAudience"); expect(result.evidence).toEqual(expect.objectContaining({ items: expect.any(Array) }));
  });

  it("retries only transaction write conflicts within a finite boundary", async () => {
    const conflict = Object.assign(new Error("deadlock"), { code: "P2034" });
    const transaction = vi.fn().mockRejectedValueOnce(conflict).mockResolvedValueOnce("ok");
    const repository = new PolicyRepository({ $transaction: transaction } as unknown as PrismaClient);
    await expect(repository.transaction(async () => "ok")).resolves.toBe("ok");
    expect(transaction).toHaveBeenCalledTimes(2);

    const domainError = Object.assign(new Error("conflict"), { code: "POLICY_STATE_CONFLICT" });
    const noRetry = vi.fn().mockRejectedValue(domainError);
    const strictRepository = new PolicyRepository({ $transaction: noRetry } as unknown as PrismaClient);
    await expect(strictRepository.transaction(async () => "never")).rejects.toBe(domainError);
    expect(noRetry).toHaveBeenCalledTimes(1);
  });
});
