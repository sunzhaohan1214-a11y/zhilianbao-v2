import { ChatPanel } from "@/components/mobile/chat-panel";

export default function AiPage() {
  return <section><header><p className="text-sm font-medium text-blue-600">荷宝 AI</p><h1 className="mt-1 text-2xl font-semibold">安全结构化查询</h1><p className="mt-2 text-sm leading-6 text-neutral-500">只查询当前账号有权看到的正式数据；没有依据时会明确拒答。</p></header><div className="mt-5"><ChatPanel /></div></section>;
}
