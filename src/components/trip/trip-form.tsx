"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type NodeValue = {
  plannedStartAt: string;
  plannedEndAt: string;
  enterpriseId: string;
  locationName: string;
  address: string;
  content: string;
};

type FormValues = {
  title: string;
  purpose: string;
  note: string;
  overallEndAt: string;
  participantIds: string[];
  nodes: NodeValue[];
};

type Option = { id: string; name: string; address?: string };
type Candidate = { id: string; title: string; firstNodeAt: string; locations: string[]; activeParticipantCount: number };

const emptyNode: NodeValue = { plannedStartAt: "", plannedEndAt: "", enterpriseId: "", locationName: "", address: "", content: "" };
const emptyValues: FormValues = { title: "", purpose: "", note: "", overallEndAt: "", participantIds: [], nodes: [{ ...emptyNode }] };

function toIso(value: string) { return value ? `${value.length === 16 ? `${value}:00` : value}+08:00` : undefined; }

export function TripForm({ tripId, initialValues = emptyValues }: { tripId?: string; initialValues?: FormValues }) {
  const router = useRouter();
  const [values, setValues] = useState(initialValues);
  const [enterprises, setEnterprises] = useState<Option[]>([]);
  const [members, setMembers] = useState<Option[]>([]);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);

  useEffect(() => {
    Promise.all([
      fetch("/api/v2/enterprises?status=NORMAL&pageSize=100").then((response) => response.json()),
      fetch("/api/v2/trips/participant-options").then((response) => response.json()),
    ]).then(([enterprisePayload, memberPayload]) => {
      setEnterprises((enterprisePayload.data?.items ?? []).map((item: { id: string; name: string; address: string }) => ({ id: item.id, name: item.name, address: item.address })));
      setMembers((memberPayload.data ?? []).map((item: { id: string; name: string }) => ({ id: item.id, name: item.name })));
    }).catch(() => setMessage("企业或参与人选项加载失败，可稍后重试"));
  }, []);

  function field<K extends keyof FormValues>(name: K, value: FormValues[K]) { setValues((current) => ({ ...current, [name]: value })); }
  function nodeField(index: number, name: keyof NodeValue, value: string) {
    setValues((current) => ({ ...current, nodes: current.nodes.map((node, position) => position === index ? { ...node, [name]: value } : node) }));
  }
  function selectEnterprise(index: number, enterpriseId: string) {
    const enterprise = enterprises.find(({ id }) => id === enterpriseId);
    setValues((current) => ({ ...current, nodes: current.nodes.map((node, position) => position === index ? {
      ...node, enterpriseId, locationName: enterprise?.name ?? node.locationName, address: enterprise?.address ?? node.address,
    } : node) }));
  }

  async function save(decision?: { action: "CONTINUE_CREATE" } | { action: "JOIN_EXISTING"; tripId: string }) {
    setPending(true); setMessage(""); setCandidates([]);
    const commonBody = {
      title: values.title,
      purpose: values.purpose,
      note: values.note || undefined,
      overallEndAt: toIso(values.overallEndAt),
      nodes: values.nodes.map((node) => ({
        plannedStartAt: toIso(node.plannedStartAt),
        plannedEndAt: toIso(node.plannedEndAt),
        enterpriseId: node.enterpriseId || undefined,
        locationName: node.locationName,
        address: node.address || undefined,
        content: node.content,
      })),
    };
    const body = tripId ? commonBody : {
      ...commonBody,
      participantIds: values.participantIds,
      duplicateDecision: decision,
    };
    const response = await fetch(tripId ? `/api/v2/trips/${tripId}/update` : "/api/v2/trips", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const payload = await response.json() as { ok: boolean; data?: { id?: string; tripId?: string }; error?: { message?: string; details?: { candidates?: Candidate[] } } };
    setPending(false);
    if (!response.ok) {
      setMessage(payload.error?.message ?? "保存失败，请稍后重试");
      setCandidates(payload.error?.details?.candidates ?? []);
      return;
    }
    router.push(`/trips/${payload.data?.id ?? payload.data?.tripId ?? tripId ?? ""}`);
    router.refresh();
  }

  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); await save(); }
  const inputClass = "mt-2 w-full rounded-xl border border-black/10 bg-white px-3 py-3 outline-none focus:border-blue-500";
  return <form onSubmit={submit} className="mt-6 space-y-5">
    <section className="space-y-4 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
      <label className="block text-sm font-medium">行程标题<input required maxLength={200} value={values.title} onChange={(event) => field("title", event.target.value)} className={inputClass} /></label>
      <label className="block text-sm font-medium">总体说明<textarea required maxLength={5000} rows={3} value={values.purpose} onChange={(event) => field("purpose", event.target.value)} className={inputClass} /></label>
      <label className="block text-sm font-medium">总体结束时间（选填）<input type="datetime-local" value={values.overallEndAt} onChange={(event) => field("overallEndAt", event.target.value)} className={inputClass} /></label>
      <label className="block text-sm font-medium">备注（选填）<textarea maxLength={2000} rows={2} value={values.note} onChange={(event) => field("note", event.target.value)} className={inputClass} /></label>
      {!tripId && <label className="block text-sm font-medium">共享参与人（可多选）<select multiple value={values.participantIds} onChange={(event) => field("participantIds", [...event.target.selectedOptions].map(({ value }) => value))} className={`${inputClass} min-h-28`}>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>}
    </section>
    {values.nodes.map((node, index) => <section key={index} className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
      <div className="flex items-center justify-between"><h2 className="font-semibold">节点 {index + 1}</h2>{values.nodes.length > 1 && <button type="button" onClick={() => field("nodes", values.nodes.filter((_, position) => position !== index))} className="text-sm text-red-600">移除</button>}</div>
      <div className="mt-4 grid gap-4">
        <label className="text-sm font-medium">开始时间<input required type="datetime-local" value={node.plannedStartAt} onChange={(event) => nodeField(index, "plannedStartAt", event.target.value)} className={inputClass} /></label>
        <label className="text-sm font-medium">结束时间（选填）<input type="datetime-local" value={node.plannedEndAt} onChange={(event) => nodeField(index, "plannedEndAt", event.target.value)} className={inputClass} /></label>
        <label className="text-sm font-medium">正式企业（选填）<select value={node.enterpriseId} onChange={(event) => selectEnterprise(index, event.target.value)} className={inputClass}><option value="">自由地点 / 县外地点</option>{enterprises.map((enterprise) => <option key={enterprise.id} value={enterprise.id}>{enterprise.name} · {enterprise.address}</option>)}</select></label>
        <label className="text-sm font-medium">企业或活动地点<input required maxLength={200} value={node.locationName} onChange={(event) => nodeField(index, "locationName", event.target.value)} className={inputClass} /></label>
        <label className="text-sm font-medium">地址（选填）<input maxLength={500} value={node.address} onChange={(event) => nodeField(index, "address", event.target.value)} className={inputClass} /></label>
        <label className="text-sm font-medium">工作内容<textarea required maxLength={5000} rows={3} value={node.content} onChange={(event) => nodeField(index, "content", event.target.value)} className={inputClass} /></label>
      </div>
    </section>)}
    <button type="button" onClick={() => field("nodes", [...values.nodes, { ...emptyNode }])} className="w-full rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 font-medium text-blue-700">添加下一站</button>
    <p className="text-xs text-neutral-500">所有节点默认共用参与人；人员中途明显不同时请拆成两条行程。系统不请求 GPS，不计算路线。</p>
    {message && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{message}</p>}
    {candidates.length > 0 && <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><p className="font-medium">发现相似行程</p>{candidates.map((candidate) => <div key={candidate.id} className="mt-3 flex items-center justify-between gap-3 text-sm"><span>{candidate.title} · {candidate.locations.join(" / ")}</span><button type="button" onClick={() => save({ action: "JOIN_EXISTING", tripId: candidate.id })} className="rounded-lg bg-white px-3 py-2 text-blue-700">加入</button></div>)}<button type="button" onClick={() => save({ action: "CONTINUE_CREATE" })} className="mt-4 text-sm font-medium text-amber-800">确认是不同活动，继续创建</button></section>}
    <button disabled={pending} className="w-full rounded-xl bg-blue-600 px-4 py-3 font-medium text-white disabled:opacity-50">{pending ? "保存中…" : tripId ? "保存修改" : "发布行程"}</button>
  </form>;
}

export type { FormValues as TripFormValues };
