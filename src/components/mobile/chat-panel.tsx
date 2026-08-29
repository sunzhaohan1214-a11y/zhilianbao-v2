"use client";

import Link from "next/link";
import { FormEvent, useRef, useState } from "react";
import type { ChatResponse } from "@/modules/ai/chat";

type State = { status: "idle" | "loading" | "success" | "error"; result?: ChatResponse; message?: string };
const links = { DEMAND: "/demands/", ENTERPRISE: "/resources/enterprises/", MEMBER: "/resources/members/", POLICY: "/resources/policies/", TALENT: "/resources/talents/" } as const;

export function ChatPanel() {
  const [question, setQuestion] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });
  const lastQuestion = useRef("");

  async function ask(value: string) {
    if (!value.trim() || state.status === "loading") return;
    lastQuestion.current = value.trim();
    setState({ status: "loading" });
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch("/api/v2/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: value.trim() }), signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message || "荷宝查询失败");
      setState({ status: "success", result: body.data });
    } catch (error) {
      setState({ status: "error", message: error instanceof DOMException && error.name === "AbortError" ? "请求超时，请检查网络后重试。" : error instanceof Error ? error.message : "网络连接失败，请重试。" });
    } finally { window.clearTimeout(timeout); }
  }

  function submit(event: FormEvent) { event.preventDefault(); void ask(question); }
  return <div className="space-y-5">
    <form onSubmit={submit} className="rounded-2xl border border-black/5 bg-white p-4">
      <label htmlFor="haobao-question" className="text-sm font-medium">想查询什么？</label>
      <textarea id="haobao-question" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={500} rows={4} placeholder="例如：查企业、找团员、查政策、查需求、找人才" className="mt-2 w-full resize-none rounded-xl border border-neutral-200 p-3 text-base outline-none focus:border-blue-500" />
      <button type="submit" disabled={state.status === "loading" || !question.trim()} className="mt-3 min-h-11 w-full rounded-xl bg-blue-600 px-4 font-medium text-white disabled:bg-neutral-300">{state.status === "loading" ? "正在查询…" : "查询"}</button>
      {state.status === "loading" && <p role="status" className="mt-2 text-sm text-neutral-500">弱网环境可能需要几秒，请勿重复提交。</p>}
    </form>
    {state.status === "error" && <section role="alert" className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-800"><p>{state.message}</p><button type="button" onClick={() => void ask(lastQuestion.current)} className="mt-3 min-h-11 rounded-xl border border-red-200 bg-white px-4 font-medium">重试</button></section>}
    {state.status === "success" && state.result && <section aria-live="polite" className="rounded-2xl border border-black/5 bg-white p-4"><p className="leading-7">{state.result.answer}</p>{state.result.degraded && <p className="mt-2 text-sm text-amber-700">当前使用安全降级路径，未调用未配置的语义模型。</p>}<div className="mt-4 space-y-2">{state.result.evidence.map((item) => <Link key={`${item.sourceType}:${item.sourceId}`} href={`${links[item.sourceType]}${item.sourceId}`} className="block min-h-11 rounded-xl bg-neutral-100 px-3 py-3 text-sm text-blue-700">{item.displayLabel}</Link>)}</div></section>}
  </div>;
}
