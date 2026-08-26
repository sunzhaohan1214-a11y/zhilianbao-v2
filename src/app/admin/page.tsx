export default function AdminPage() {
  return (
    <section>
      <p className="text-sm font-medium text-blue-600">M0-001</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">管理后台基础骨架</h1>
      <p className="mt-3 max-w-2xl leading-7 text-slate-600">
        当前仅验证 PC Admin 独立布局和构建链路，尚未实现管理业务与数据看板。
      </p>
      <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">系统状态</p>
        <p className="mt-2 font-medium text-slate-900">工程基础已就绪</p>
      </div>
    </section>
  );
}
