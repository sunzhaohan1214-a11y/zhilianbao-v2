import { CapabilityProfileForm } from "@/components/member/capability-profile-form";
import { memberFoundationPageContext } from "@/lib/member-foundation/page-context";
export default async function MyCapabilityPage() {
  const { actor, members } = await memberFoundationPageContext();
  const [member, options] = await Promise.all([members.detail({ actor, personId: actor.personId }), members.options({ actor })]);
  return <section><h1 className="text-2xl font-semibold">我的能力画像</h1><p className="mt-2 text-sm text-slate-500">仅保存业务字段，不允许在此修改手机号、批次或角色。</p><div className="mt-5"><CapabilityProfileForm personId={actor.personId} industries={options.industries} initial={member.capabilityProfile} /></div></section>;
}
