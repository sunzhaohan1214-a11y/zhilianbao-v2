import { z } from "zod";
import type { PermissionActor } from "@/modules/permissions/types";
import { authorizeActor } from "@/modules/permissions/authorization";
import { FormalDemandService } from "@/modules/demand/formal-demand-service";
import { EnterpriseService } from "@/modules/enterprise/enterprise-service";
import { MemberService } from "@/modules/member-foundation/member-service";
import { PolicyService } from "@/modules/policy/policy-service";
import { TalentService } from "@/modules/talent/talent-service";
import { planChatQuery } from "./query-planner";

export const chatRequestSchema = z.object({ message: z.string().trim().min(1).max(500) }).strict();
export type ChatEvidence = { sourceType: "DEMAND" | "ENTERPRISE" | "MEMBER" | "POLICY" | "TALENT"; sourceId: string; displayLabel: string };
export type ChatResponse = { mode: "STRUCTURED" | "SEMANTIC" | "HYBRID"; answer: string; evidence: ChatEvidence[]; degraded: boolean; errorCode?: string };

export class ChatService {
  constructor(
    private readonly demands = new FormalDemandService(),
    private readonly enterprises = new EnterpriseService(),
    private readonly members = new MemberService(),
    private readonly policies = new PolicyService(),
    private readonly talents = new TalentService(),
  ) {}

  async ask(input: { actor: PermissionActor; body: unknown }): Promise<ChatResponse> {
    await authorizeActor({ actor: input.actor, action: "ai.assistant.use" });
    const { message } = chatRequestSchema.parse(input.body);
    const plan = planChatQuery(message);
    if (plan.intent === "PRIVATE_FORBIDDEN") return { mode: plan.mode, answer: "该问题涉及专属或未发布数据，荷宝不能代为查询。", evidence: [], degraded: false, errorCode: "AI_PRIVATE_QUERY_FORBIDDEN" };
    if (plan.intent === "UNKNOWN") return { mode: plan.mode, answer: "当前未查询到可靠的结构化信息。语义服务未配置时，可改为查询需求、企业、团员、政策或人才。", evidence: [], degraded: true, errorCode: "AI_SEMANTIC_PROVIDER_UNAVAILABLE" };
    const query = plan.keyword;
    if (plan.intent === "DEMAND") {
      const result = await this.demands.list({ actor: input.actor, query: { keyword: query, page: 1, pageSize: 5 } });
      return result.items.length ? { mode: plan.mode, answer: `查询到 ${result.total} 条可见需求，展示前 ${result.items.length} 条。`, evidence: result.items.map((item) => ({ sourceType: "DEMAND", sourceId: item.id, displayLabel: item.title })), degraded: false } : empty(plan.mode);
    }
    if (plan.intent === "ENTERPRISE") {
      const result = await this.enterprises.list({ actor: input.actor, query: { keyword: query, page: 1, pageSize: 5 } });
      return result.items.length ? { mode: plan.mode, answer: `查询到 ${result.total} 家可见企业，展示前 ${result.items.length} 家。`, evidence: result.items.map((item) => ({ sourceType: "ENTERPRISE", sourceId: item.id, displayLabel: item.name })), degraded: false } : empty(plan.mode);
    }
    if (plan.intent === "MEMBER") {
      const result = await this.members.list({ actor: input.actor, query: { kind: "current", keyword: query, page: 1, pageSize: 5 } });
      return result.items.length ? { mode: plan.mode, answer: `查询到 ${result.total} 名可见在任团员，展示前 ${result.items.length} 名。`, evidence: result.items.map((item) => ({ sourceType: "MEMBER", sourceId: item.id, displayLabel: item.name })), degraded: false } : empty(plan.mode);
    }
    if (plan.intent === "POLICY") {
      const result = await this.policies.list({ actor: input.actor, query: { keyword: query, effectStatus: "CURRENT", publicationStatus: "PUBLISHED", page: 1, pageSize: 5 } });
      return result.items.length ? { mode: plan.mode, answer: `查询到 ${result.total} 条可见政策，展示前 ${result.items.length} 条。`, evidence: result.items.map((item) => ({ sourceType: "POLICY", sourceId: item.id, displayLabel: item.title })), degraded: false } : empty(plan.mode);
    }
    const result = await this.talents.list({ actor: input.actor, query: { keyword: query, page: 1, pageSize: 5 } });
    return result.items.length ? { mode: plan.mode, answer: `查询到 ${result.total} 位可见人才，展示前 ${result.items.length} 位。`, evidence: result.items.map((item) => ({ sourceType: "TALENT", sourceId: item.id, displayLabel: item.name })), degraded: false } : empty(plan.mode);
  }
}

function empty(mode: ChatResponse["mode"]): ChatResponse {
  return { mode, answer: "当前未查询到可靠信息。", evidence: [], degraded: false, errorCode: "AI_NO_RELIABLE_INFORMATION" };
}
