import { memberFoundationPageContext } from "@/lib/member-foundation/page-context";
const membershipStatusLabel: Record<string, string> = { ACTIVE: "当前批次", ENDED: "已结束", WITHDRAWN: "已退出" };
export default async function MemberDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { actor, members } = await memberFoundationPageContext(); const member = await members.detail({ actor, personId: (await params).id });
  return <section><h1 className="text-2xl font-semibold">{member.name}</h1><p className="mt-2 text-sm text-slate-500">{member.kind === "current" ? "在任团员" : "往届团员"} · {member.hasLoginAccount ? "已关联登录账号" : "历史档案"}</p>
    <div className="mt-5 rounded-2xl bg-white p-5 shadow-sm"><h2 className="font-semibold">联系方式</h2>{member.contactPhone ? <a href={`tel:${member.contactPhone}`} className="mt-2 block text-blue-600">{member.contactPhone}</a> : <p className="mt-2 text-sm text-slate-500">暂无联系电话</p>}</div>
    <div className="mt-3 rounded-2xl bg-white p-5 shadow-sm"><h2 className="font-semibold">专业与资源</h2><p className="mt-2 text-sm">{member.capabilityProfile?.professionalDirection ?? "暂无专业方向"}</p><p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{member.capabilityProfile?.coordinatableResources ?? "暂无可协调资源"}</p></div>
    <div className="mt-3 rounded-2xl bg-white p-5 shadow-sm"><h2 className="font-semibold">批次履历</h2><div className="mt-3 space-y-3">{member.memberships.map((item) => <div key={item.id} className="border-t border-slate-100 pt-3"><p className="font-medium">{item.batch.name} · {membershipStatusLabel[item.status] ?? "状态待确认"}</p><p className="text-sm text-slate-500">{item.dispatchOrganization?.name ?? "未录派出单位"} → {item.postOrganization?.name ?? "未录挂职单位"}</p></div>)}</div></div>
    <div className="mt-3 rounded-2xl bg-white p-5 shadow-sm"><h2 className="font-semibold">工作历史</h2>{member.appointments.length ? member.appointments.map((item) => <p key={item.id} className="mt-2 text-sm">{item.organization.name} · {item.positionTitle}</p>) : <p className="mt-2 text-sm text-slate-500">暂无工作历史</p>}</div>
  </section>;
}
