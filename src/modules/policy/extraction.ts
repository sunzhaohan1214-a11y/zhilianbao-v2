export type PolicyExtractionResult = {
  extracted: Record<string, unknown>;
  evidence: Record<string, unknown>;
  provider: string;
  model: string;
  promptVersion: string;
};

export interface PolicyExtractionAdapter {
  extract(input: { policyId: string; versionId: string; primaryAttachmentId: string; supplementaryAttachmentIds: string[] }): Promise<PolicyExtractionResult>;
}

export class UnavailablePolicyExtractionAdapter implements PolicyExtractionAdapter {
  async extract(): Promise<PolicyExtractionResult> {
    throw Object.assign(new Error("政策智能提取暂不可用，请继续手工录入"), { code: "POLICY_EXTRACTION_UNAVAILABLE" });
  }
}

export class FakePolicyExtractionAdapter implements PolicyExtractionAdapter {
  async extract(input: { policyId: string; versionId: string; primaryAttachmentId: string; supplementaryAttachmentIds: string[] }): Promise<PolicyExtractionResult> {
    return {
      provider: "fake",
      model: "fake-policy-extractor",
      promptVersion: "policy-extract-v1",
      extracted: {
        title: "AI 候选政策名称",
        issuingDepartment: "AI 候选发布部门",
        targetAudience: "AI 候选适用对象",
        supportContent: "AI 候选支持内容",
        applicationConditions: "AI 候选申报条件",
        keyClauses: ["AI 候选关键条款"],
      },
      evidence: { items: [{ attachmentId: input.primaryAttachmentId, relationType: "PRIMARY", page: 1, locator: "第1页" }] },
    };
  }
}
