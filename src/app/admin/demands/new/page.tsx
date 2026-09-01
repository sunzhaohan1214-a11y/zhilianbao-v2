import { FormalDemandCreateForm } from "@/components/demand/formal-demand-create-form";
import { formalDemandPageContext } from "@/lib/demand/formal-page-context";

export default async function AdminNewFormalDemandPage() {
  const { actor, service } = await formalDemandPageContext();
  const options = await service.formOptions({ actor, sourceType: "ADMIN_DIRECT" });
  return <section><p className="text-sm font-medium text-blue-600">需求与成效</p><h1 className="mt-1 text-3xl font-semibold">管理员代录正式需求</h1><p className="mt-2 text-slate-600">先保存管理员代录草稿；仅该来源草稿允许管理员直接发布。</p><FormalDemandCreateForm areas={options.areas} sourceType="ADMIN_DIRECT"/></section>;
}
