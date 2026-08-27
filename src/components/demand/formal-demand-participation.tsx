"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type Person = { id: string; name: string };
type PendingRequest = { id: string; person: Person; requestType: "APPLY" | "INVITE"; requestedBy: Person };

async function command(path: string, body: unknown, headers?: Record<string, string>) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message ?? "操作失败");
  return payload.data;
}

export function FormalDemandParticipation({ demand, canClaim, canApplyCollaboration, canManageCollaboration, canAcceptInvitation, canLeaveCollaboration }: {
  demand: {
    id: string;
    myRelation: "NONE" | "OWNER" | "COLLABORATOR" | "APPLIED_PENDING" | "INVITED_PENDING";
    currentOwner: Person | null;
    collaborators: { id: string; personId: string; person: Person }[];
    pendingCollaborationForMe: { id: string; personId: string; requestType: "APPLY" | "INVITE" } | null;
    pendingCollaborationRequests: PendingRequest[];
  };
  canClaim: boolean;
  canApplyCollaboration: boolean;
  canManageCollaboration: boolean;
  canAcceptInvitation: boolean;
  canLeaveCollaboration: boolean;
}) {
  const router = useRouter();
  const claimKey = useRef(crypto.randomUUID());
  const searchVersion = useRef(0);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [candidates, setCandidates] = useState<Person[]>([]);
  const [leaveReason, setLeaveReason] = useState("");
  const [removeReasons, setRemoveReasons] = useState<Record<string, string>>({});

  async function run(operation: () => Promise<unknown>) {
    setPending(true);
    setMessage("");
    try {
      await operation();
      setMessage("操作已完成。");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
    } finally {
      setPending(false);
    }
  }

  async function search(keyword: string) {
    const version = ++searchVersion.current;
    if (!keyword.trim()) return setCandidates([]);
    const response = await fetch(`/api/v2/members/collaboration-candidates?keyword=${encodeURIComponent(keyword.trim())}&limit=20`);
    const payload = await response.json();
    if (version !== searchVersion.current) return;
    if (!response.ok) throw new Error(payload.error?.message ?? "团员搜索失败");
    const unavailable = new Set([
      demand.currentOwner?.id,
      ...demand.collaborators.map(({ personId }) => personId),
      ...demand.pendingCollaborationRequests.map(({ person }) => person.id),
    ]);
    setCandidates((payload.data as Person[]).filter(({ id }) => !unavailable.has(id)));
  }

  const primary = "min-h-12 w-full rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white disabled:opacity-50 sm:w-auto";
  const applicantRequests = demand.pendingCollaborationRequests.filter(({ requestType }) => requestType === "APPLY");
  return (
    <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
      <h2 className="text-lg font-semibold text-blue-950">负责人和协同</h2>
      <p className="mt-2 text-sm text-blue-900">当前负责人：{demand.currentOwner?.name ?? "待认领"}</p>
      <p className="mt-1 text-sm text-blue-800">协同人：{demand.collaborators.length ? demand.collaborators.map(({ person }) => person.name).join("、") : "暂无"}</p>
      <div className="mt-4">
        {canClaim && <button type="button" disabled={pending} className={primary} onClick={() => void run(() => command(`/api/v2/demands/${demand.id}/claim`, {}, { "Idempotency-Key": claimKey.current }))}>我要对接</button>}
        {canApplyCollaboration && <button type="button" disabled={pending} className={primary} onClick={() => void run(() => command(`/api/v2/demands/${demand.id}/collaboration/apply`, {}))}>申请协同</button>}
        {canAcceptInvitation && demand.pendingCollaborationForMe && <button type="button" disabled={pending} className={primary} onClick={() => void run(() => command(`/api/v2/demands/${demand.id}/collaboration/${demand.pendingCollaborationForMe!.personId}/approve`, {}))}>接受协同邀请</button>}
        {demand.myRelation === "APPLIED_PENDING" && <p className="rounded-xl bg-white p-3 text-sm text-blue-900">协同申请待主责确认</p>}
        {demand.myRelation === "COLLABORATOR" && <p className="rounded-xl bg-white p-3 text-sm text-blue-900">协同中</p>}
      </div>
      {canManageCollaboration && <div className="mt-5 space-y-4 border-t border-blue-200 pt-4">
        <div><h3 className="font-medium text-blue-950">待处理申请</h3>{applicantRequests.length === 0 ? <p className="mt-2 text-sm text-blue-700">暂无待处理申请。</p> : <ul className="mt-2 space-y-2">{applicantRequests.map((request) => <li key={request.id} className="flex items-center justify-between gap-3 rounded-xl bg-white p-3 text-sm"><span>{request.person.name}</span><button type="button" disabled={pending} className="rounded-lg bg-emerald-600 px-3 py-2 font-medium text-white" onClick={() => void run(() => command(`/api/v2/demands/${demand.id}/collaboration/${request.person.id}/approve`, {}))}>同意协同</button></li>)}</ul>}</div>
        <div><h3 className="font-medium text-blue-950">邀请协同人</h3><input aria-label="按姓名搜索协同人" placeholder="输入团员姓名" className="mt-2 w-full rounded-xl border border-blue-200 bg-white p-3" onChange={(event) => void search(event.target.value).catch((error) => setMessage(error instanceof Error ? error.message : "团员搜索失败"))} />{candidates.length > 0 && <ul className="mt-2 divide-y rounded-xl border border-blue-100 bg-white">{candidates.map((person) => <li key={person.id} className="flex items-center justify-between gap-3 p-3 text-sm"><span>{person.name}</span><button type="button" disabled={pending} className="rounded-lg border border-blue-300 px-3 py-2 text-blue-800" onClick={() => void run(() => command(`/api/v2/demands/${demand.id}/collaboration/invite`, { personId: person.id }))}>发出邀请</button></li>)}</ul>}</div>
        {demand.collaborators.length > 0 && <div><h3 className="font-medium text-blue-950">管理协同人</h3><ul className="mt-2 space-y-2">{demand.collaborators.map(({ person }) => <li key={person.id} className="rounded-xl bg-white p-3 text-sm"><span className="font-medium">{person.name}</span><div className="mt-2 flex flex-col gap-2 sm:flex-row"><input aria-label={`移除 ${person.name} 的原因`} required maxLength={500} placeholder="填写移除原因" value={removeReasons[person.id] ?? ""} onChange={(event) => setRemoveReasons((current) => ({ ...current, [person.id]: event.target.value }))} className="min-h-10 flex-1 rounded-lg border p-2"/><button type="button" disabled={pending || !(removeReasons[person.id] ?? "").trim()} className="rounded-lg border border-red-200 px-3 py-2 text-red-700 disabled:opacity-50" onClick={() => void run(() => command(`/api/v2/demands/${demand.id}/collaboration/${person.id}/remove`, { reason: removeReasons[person.id] }))}>移除</button></div></li>)}</ul></div>}
      </div>}
      {canLeaveCollaboration && <div className="mt-4 flex flex-col gap-2 sm:flex-row"><input aria-label="退出协同原因" required maxLength={500} placeholder="填写退出原因" value={leaveReason} onChange={(event) => setLeaveReason(event.target.value)} className="min-h-10 flex-1 rounded-lg border bg-white p-2 text-sm"/><button type="button" disabled={pending || !leaveReason.trim()} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 disabled:opacity-50" onClick={() => void run(() => command(`/api/v2/demands/${demand.id}/collaboration/leave`, { reason: leaveReason }))}>退出协同</button></div>}
      {message && <p role="status" className="mt-4 rounded-xl bg-white p-3 text-sm text-slate-700">{message}</p>}
    </section>
  );
}
