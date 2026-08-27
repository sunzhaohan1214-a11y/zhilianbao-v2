import { FormalDemandCreateForm } from "@/components/demand/formal-demand-create-form";
import { formalDemandPageContext } from "@/lib/demand/formal-page-context";

export default async function NewFormalDemandPage() {
  const { actor, service } = await formalDemandPageContext();
  const options = await service.formOptions({ actor, sourceType: "TOWNSHIP_DIRECT" });
  return <section><p className="text-sm font-medium text-blue-600">正式需求</p><h1 className="mt-1 text-2xl font-semibold">新建草稿</h1><p className="mt-2 text-sm text-slate-600">选择正式企业与 ACTIVE 联系人；创建后仍需提交管理员审核。</p><FormalDemandCreateForm areas={options.areas} sourceType="TOWNSHIP_DIRECT"/></section>;
}
