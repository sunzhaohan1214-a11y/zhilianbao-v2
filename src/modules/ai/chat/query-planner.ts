export type ChatIntent = "DEMAND" | "ENTERPRISE" | "MEMBER" | "POLICY" | "TALENT" | "PRIVATE_FORBIDDEN" | "UNKNOWN";
export type ChatPlan = { mode: "STRUCTURED" | "SEMANTIC" | "HYBRID"; intent: ChatIntent; keyword?: string };

const PRIVATE_PATTERNS = [/报销/, /未发布.*线索/, /他人.*(?:对话|荷宝|正文)/, /未授权.*联系人/];
const STRUCTURED_INTENTS: Array<[ChatIntent, RegExp]> = [
  ["DEMAND", /需求/], ["ENTERPRISE", /企业/], ["MEMBER", /团员|成员/], ["POLICY", /政策/], ["TALENT", /人才/],
];

export function planChatQuery(message: string): ChatPlan {
  const normalized = message.trim();
  if (PRIVATE_PATTERNS.some((pattern) => pattern.test(normalized))) return { mode: "STRUCTURED", intent: "PRIVATE_FORBIDDEN" };
  const match = STRUCTURED_INTENTS.find(([, pattern]) => pattern.test(normalized));
  if (match) return { mode: "STRUCTURED", intent: match[0], keyword: normalized.replace(match[1], "").replace(/^(查|找|查询|搜索|多少|有哪些)+/, "").trim() || undefined };
  return { mode: "SEMANTIC", intent: "UNKNOWN" };
}
