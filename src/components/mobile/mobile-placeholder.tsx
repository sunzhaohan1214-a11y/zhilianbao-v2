interface MobilePlaceholderProps {
  title: string;
  description: string;
}

export function MobilePlaceholder({ title, description }: MobilePlaceholderProps) {
  return (
    <section>
      <p className="text-sm font-medium text-blue-600">基础页面</p>
      <h2 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-3 leading-7 text-neutral-500">{description}</p>
      <div className="mt-8 rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
        <div className="h-2 w-16 rounded-full bg-blue-500/80" />
        <p className="mt-5 text-sm leading-6 text-neutral-500">
          M0-001 仅建立可扩展的页面结构，尚未接入业务数据与业务操作。
        </p>
      </div>
    </section>
  );
}
