import { InternalDemandLeadCreateForm } from "@/components/demand/internal-demand-lead-create-form";
import { demandLeadPageContext } from "@/lib/demand/page-context";
import { EnterpriseService } from "@/modules/enterprise";

export default async function AdminDemandLeadNewPage() {
  const { actor } = await demandLeadPageContext();
  const options = await new EnterpriseService().formOptions({ actor, purpose: "FORMAL_CREATE" });
  return <section><p className="text-sm font-medium text-blue-600">M1-002 Demand Lead</p><h1 className="mt-1 text-3xl font-semibold">录入其他来源线索</h1><p className="mt-2 text-slate-600">只保存原始来源；后续核验通过追加记录完成。</p><InternalDemandLeadCreateForm areas={options.areas} /></section>;
}
