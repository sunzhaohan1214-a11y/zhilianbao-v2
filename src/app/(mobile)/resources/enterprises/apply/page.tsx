import Link from "next/link";
import { EnterpriseApplicationForm } from "@/components/enterprise/change-request-forms";
import { enterprisePageContext } from "@/lib/enterprise/page-context";

export default async function EnterpriseApplyPage() {
  const { actor, service } = await enterprisePageContext(); const options = await service.formOptions({ actor, purpose: "CREATE_APPLICATION" });
  return <section><Link href="/resources/enterprises" className="text-sm text-blue-600">‹ 返回企业名录</Link><h2 className="my-4 text-2xl font-semibold">企业新增申请</h2><EnterpriseApplicationForm areas={options.areas} tags={options.tags} /></section>;
}
