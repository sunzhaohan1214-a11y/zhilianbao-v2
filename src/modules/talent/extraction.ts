export type TalentExtractionCandidate = {
  workEducationExperience?: string;
  representativeAchievements?: string;
  structured?: {
    experiences?: unknown[];
    projects?: unknown[];
    patents?: unknown[];
    papers?: unknown[];
    awards?: unknown[];
  };
};
export interface TalentExtractionAdapter {
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  extract(input: {
    attachmentId: string;
  }): Promise<{ candidate: TalentExtractionCandidate; evidence: unknown }>;
}
export class UnavailableTalentExtractionAdapter implements TalentExtractionAdapter {
  readonly provider = "unavailable";
  readonly model = "unavailable";
  readonly promptVersion = "talent-v1";
  async extract(): Promise<never> {
    throw new Error("TALENT_AI_EXTRACTION_UNAVAILABLE");
  }
}
export class FakeTalentExtractionAdapter implements TalentExtractionAdapter {
  readonly provider = "fake";
  readonly model = "fake-talent-extractor";
  readonly promptVersion = "talent-v1";
  async extract(input: { attachmentId: string }) {
    return {
      candidate: {
        workEducationExperience: "测试提取的工作与教育经历",
        representativeAchievements: "测试提取的代表性成果",
        structured: {
          experiences: [],
          projects: [],
          patents: [],
          papers: [],
          awards: [],
        },
      },
      evidence: { attachmentId: input.attachmentId },
    };
  }
}
