import { PublicDemandForm } from "@/components/demand/public-demand-form";

export default async function PublicDemandPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const responsibleAreaId = typeof params.areaId === "string" ? params.areaId : "";
  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <p className="text-sm font-medium tracking-[0.18em] text-blue-600">智链宝 · 企业需求</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">提交需求线索</h1>
        <p className="mt-3 text-slate-600">无需登录。请填写最小必要信息，负责镇区将在收到后联系核实。</p>
        <div className="mt-8">
          {responsibleAreaId
            ? <PublicDemandForm responsibleAreaId={responsibleAreaId} />
            : <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-amber-900"><h2 className="font-semibold">公开链接缺少负责区域</h2><p className="mt-2 text-sm">请使用镇区提供的完整固定链接或二维码进入。</p></section>}
        </div>
      </div>
    </main>
  );
}
