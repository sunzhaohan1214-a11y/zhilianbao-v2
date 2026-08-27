"use client";
import { useState } from "react";

type Industry = { id: string; name: string };
export function CapabilityProfileForm({ personId, industries, initial }: { personId: string; industries: Industry[]; initial?: { professionalDirection?: string | null; coordinatableResources?: string | null; personalIntroduction?: string | null; industries?: Industry[]; preferredDemandTypes?: string[] } | null }) {
  void personId;
  const [message, setMessage] = useState("");
  async function submit(formData: FormData) {
    setMessage("保存中…");
    const response = await fetch("/api/v2/members/me/capability-profile", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        professionalDirection: formData.get("professionalDirection"),
        coordinatableResources: formData.get("coordinatableResources"),
        personalIntroduction: formData.get("personalIntroduction"),
        industryIds: formData.getAll("industryIds"), preferredDemandTypes: formData.getAll("preferredDemandTypes"),
      }),
    });
    const payload = await response.json();
    setMessage(response.ok ? "能力画像已保存" : payload.error?.message ?? "保存失败");
  }
  return <form action={submit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
    <label className="block text-sm font-medium">专业方向<textarea name="professionalDirection" defaultValue={initial?.professionalDirection ?? ""} maxLength={500} className="mt-1 min-h-20 w-full rounded-xl border border-slate-200 p-3" /></label>
    <label className="block text-sm font-medium">可协调资源<textarea name="coordinatableResources" defaultValue={initial?.coordinatableResources ?? ""} maxLength={5000} className="mt-1 min-h-24 w-full rounded-xl border border-slate-200 p-3" /></label>
    <label className="block text-sm font-medium">个人简介<textarea name="personalIntroduction" defaultValue={initial?.personalIntroduction ?? ""} maxLength={5000} className="mt-1 min-h-24 w-full rounded-xl border border-slate-200 p-3" /></label>
    <fieldset><legend className="text-sm font-medium">行业</legend><div className="mt-2 flex flex-wrap gap-3">{industries.map((industry) => <label key={industry.id} className="text-sm"><input type="checkbox" name="industryIds" value={industry.id} defaultChecked={initial?.industries?.some(({ id }) => id === industry.id)} /> {industry.name}</label>)}</div></fieldset>
    <fieldset><legend className="text-sm font-medium">偏好需求类型</legend><div className="mt-2 flex flex-wrap gap-3">{[["TECHNICAL", "技术"], ["TALENT", "人才"], ["PROJECT", "项目"], ["OTHER", "其他"]].map(([code, label]) => <label key={code} className="text-sm"><input type="checkbox" name="preferredDemandTypes" value={code} defaultChecked={initial?.preferredDemandTypes?.includes(code)} /> {label}</label>)}</div></fieldset>
    <button className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white">保存能力画像</button><p role="status" className="text-sm text-slate-600">{message}</p>
  </form>;
}
