import { AdminPolicyCreateForm } from "@/components/policy/admin-policy-forms";
import { policyPageContext } from "@/lib/policy/page-context";

export default async function NewPolicyPage() { const { actor, service } = await policyPageContext(); const options = await service.formOptions({ actor }); return <section><p className="text-sm text-blue-600">政策治理</p><h1 className="mt-1 text-3xl font-semibold">新增政策草稿</h1><p className="mt-2 text-sm text-slate-500">必须上传一个主政策文件；AI 结果不会自动写入或发布。</p><div className="mt-6"><AdminPolicyCreateForm tags={options.tags.map(({ id, name }) => ({ id, name }))}/></div></section>; }
