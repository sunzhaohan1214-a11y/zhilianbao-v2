import { describe, expect, it } from "vitest";
import { configEvaluationVersion } from "@/modules/ai/evaluation";
import { planChatQuery } from "@/modules/ai/chat";
import { sanitizeAiText, sanitizeAiValue } from "@/modules/demand/recommendation-rules";

describe("M3-008 AI contract evaluation", () => {
  it.each([
    ["查询我的需求", "DEMAND"], ["查企业", "ENTERPRISE"], ["找团员", "MEMBER"], ["问政策", "POLICY"], ["找人才", "TALENT"],
  ])("plans %s through an authorized structured intent", (message, intent) => {
    expect(planChatQuery(message)).toMatchObject({ mode: "STRUCTURED", intent });
  });

  it.each(["查询不属于我的报销", "查询其他镇区未发布线索", "查询他人荷宝正文", "查询未授权联系人"])("refuses private query: %s", (message) => {
    expect(planChatQuery(message).intent).toBe("PRIVATE_FORBIDDEN");
  });

  it("returns an explicit semantic degradation for unsupported questions", () => {
    expect(planChatQuery("这个结论是真的吗")).toEqual({ mode: "SEMANTIC", intent: "UNKNOWN" });
  });

  it("sanitizes runtime-assembled phone, id card, and email values recursively", () => {
    const phone = ["138", "0000", "0000"].join("");
    const idCard = ["320101", "19900101", "001", "X"].join("");
    const email = ["test", "example.invalid"].join("@");
    const sanitized = sanitizeAiValue({ nested: { text: `${phone} ${idCard} ${email}` } });
    expect(JSON.stringify(sanitized)).not.toContain(phone);
    expect(JSON.stringify(sanitized)).not.toContain(idCard);
    expect(JSON.stringify(sanitized)).not.toContain(email);
    expect(sanitizeAiText(phone)).toContain("[REDACTED_PHONE]");
  });

  it("invalidates evaluation binding after any provider, model, policy, prompt dataset, or config-version change", () => {
    const config = { capability: "CHAT", provider: "provider-a", model: "model-a", retentionPolicy: "NONE", maxRetentionDays: 0, trainingOptOut: true, version: 1 };
    const current = configEvaluationVersion(config);
    expect(configEvaluationVersion({ ...config })).toBe(current);
    expect(configEvaluationVersion({ ...config, model: "model-b" })).not.toBe(current);
    expect(configEvaluationVersion({ ...config, retentionPolicy: "THIRTY_DAYS" })).not.toBe(current);
    expect(configEvaluationVersion({ ...config, version: 2 })).not.toBe(current);
  });
});
