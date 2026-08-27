"use client";

import { useState } from "react";

function useSubmit() {
  const [message, setMessage] = useState("");
  async function send(url: string, body: unknown) {
    setMessage("保存中…");
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json();
    setMessage(response.ok ? "保存成功，请刷新页面" : payload.error?.message ?? "保存失败");
  }
  return { message, send };
}

export function CreateBatchForm() {
  const { message, send } = useSubmit();
  return <form action={(data) => send("/api/v2/admin/batches", {
    name: data.get("name"), year: Number(data.get("year")), startDate: data.get("startDate"), endDate: data.get("endDate") || null,
  })} className="grid gap-3 rounded-2xl border bg-white p-5 md:grid-cols-4">
    <input name="name" required placeholder="批次名称" className="rounded-lg border p-2" />
    <input name="year" required type="number" min="2000" max="2200" placeholder="年度" className="rounded-lg border p-2" />
    <input name="startDate" required type="date" className="rounded-lg border p-2" /><input name="endDate" type="date" className="rounded-lg border p-2" />
    <button className="rounded-lg bg-blue-600 px-3 py-2 text-white">新建计划批次</button><p role="status" className="text-sm text-slate-500">{message}</p>
  </form>;
}

export function OrganizationForms({ people, organizations, areas }: {
  people: Array<{ id: string; name: string }>;
  organizations: Array<{ id: string; name: string; type: string }>;
  areas: Array<{ id: string; name: string }>;
}) {
  const { message, send } = useSubmit();
  return <div className="grid gap-5 xl:grid-cols-3">
    <form action={(data) => send("/api/v2/admin/organizations", {
      name: data.get("name"), type: data.get("type"), phone: data.get("phone"), address: data.get("address"),
    })} className="space-y-3 rounded-2xl border bg-white p-5">
      <h2 className="font-semibold">新建组织</h2><input name="name" required placeholder="名称" className="w-full rounded-lg border p-2" />
      <select name="type" className="w-full rounded-lg border p-2"><option value="DEPARTMENT">部门</option><option value="TOWNSHIP_ORG">镇区组织</option><option value="DISPATCH_UNIT">派出单位</option><option value="POST_UNIT">挂职单位</option><option value="OTHER_INTERNAL">其他内部组织</option></select>
      <input name="phone" placeholder="单位电话" className="w-full rounded-lg border p-2" /><input name="address" placeholder="地址" className="w-full rounded-lg border p-2" /><button className="rounded-lg bg-blue-600 px-3 py-2 text-white">创建</button>
    </form>
    <form action={(data) => send("/api/v2/admin/appointments", {
      personId: data.get("personId"), organizationId: data.get("organizationId"), positionTitle: data.get("positionTitle"), effectiveAt: data.get("effectiveAt"), expiredAt: null, isPrimary: data.get("isPrimary") === "on",
    })} className="space-y-3 rounded-2xl border bg-white p-5">
      <h2 className="font-semibold">新增任职</h2>
      <select name="personId" required className="w-full rounded-lg border p-2"><option value="">人员</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
      <select name="organizationId" required className="w-full rounded-lg border p-2"><option value="">组织</option>{organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <input name="positionTitle" required placeholder="职务" className="w-full rounded-lg border p-2" /><input name="effectiveAt" type="date" required className="w-full rounded-lg border p-2" />
      <label className="block text-sm"><input name="isPrimary" type="checkbox" /> 设为主要任职</label><button className="rounded-lg bg-blue-600 px-3 py-2 text-white">新增任职</button>
    </form>
    <form action={(data) => send("/api/v2/admin/department-area-relations", {
      departmentOrganizationId: data.get("departmentOrganizationId"), areaId: data.get("areaId"), effectiveAt: data.get("effectiveAt"), expiredAt: null,
    })} className="space-y-3 rounded-2xl border bg-white p-5">
      <h2 className="font-semibold">部门—镇区关系</h2>
      <select name="departmentOrganizationId" required className="w-full rounded-lg border p-2"><option value="">部门</option>{organizations.filter(({ type }) => type === "DEPARTMENT").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <select name="areaId" required className="w-full rounded-lg border p-2"><option value="">镇区/园区</option>{areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select>
      <input name="effectiveAt" type="date" required className="w-full rounded-lg border p-2" /><button className="rounded-lg bg-blue-600 px-3 py-2 text-white">建立关系</button>
    </form><p role="status" className="text-sm text-slate-500">{message}</p>
  </div>;
}
