import Link from "next/link";
import type { FormalDemandService } from "@/modules/demand";

type Result = Awaited<ReturnType<FormalDemandService["list"]>>;

const statusLabel: Record<string, string> = {
  DRAFT: "草稿",
  PENDING_REVIEW: "待审核",
  RETURNED: "退回修改",
  PENDING_CLAIM: "待对接",
  IN_PROGRESS: "对接中",
  PENDING_CLOSE_REVIEW: "待办结审核",
  COMPLETED: "已办结",
  CANCELED: "已取消",
  MERGED: "已合并",
};

const typeLabel: Record<string, string> = {
  TECHNICAL: "技术攻关",
  TALENT: "人才合作",
  PROJECT: "项目落地",
  OTHER: "其他需求",
};

export function FormalDemandList({ result, admin = false }: { result: Result; admin?: boolean }) {
  const items = "items" in result ? result.items : [];
  return (
    <div className={admin ? "mt-5 overflow-x-auto rounded-2xl border bg-white" : "mt-5 space-y-3"}>
      {admin ? (
        <>
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500"><tr><th className="p-4">需求</th><th className="p-4">企业</th><th className="p-4">区域</th><th className="p-4">类型</th><th className="p-4">负责人</th><th className="p-4">状态</th></tr></thead>
            <tbody>{items.map((demand) => <tr key={demand.id} className="border-t"><td className="p-4"><Link className="font-medium text-blue-700" href={`/admin/demands/${demand.id}`}>{demand.businessNo}</Link><p className="mt-1 max-w-sm truncate text-slate-600">{demand.title}</p></td><td className="p-4">{demand.enterprise.name}</td><td className="p-4">{demand.responsibleArea.name}</td><td className="p-4">{typeLabel[demand.demandType] ?? demand.demandType}</td><td className="p-4">{demand.currentOwner?.name ?? "待认领"}</td><td className="p-4">{statusLabel[demand.status] ?? demand.status}</td></tr>)}</tbody>
          </table>
          {items.length === 0 && <p className="p-8 text-center text-slate-500">暂无符合条件的正式需求。</p>}
        </>
      ) : (
        <>
          {items.map((demand) => <Link key={demand.id} href={`/demands/${demand.id}`} className="block rounded-2xl border border-black/5 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-medium text-blue-600">{demand.businessNo}</p><h3 className="mt-1 font-semibold">{demand.title}</h3><p className="mt-1 text-sm text-neutral-500">{demand.enterprise.name} · {demand.responsibleArea.name}</p><p className="mt-1 text-xs text-neutral-500">负责人：{demand.currentOwner?.name ?? "待认领"}</p></div><span className="shrink-0 rounded-full bg-blue-50 px-2 py-1 text-xs text-blue-700">{statusLabel[demand.status] ?? demand.status}</span></div></Link>)}
          {items.length === 0 && <div className="rounded-2xl border border-dashed bg-white p-8 text-center text-sm text-neutral-500">暂无符合条件的正式需求。</div>}
        </>
      )}
    </div>
  );
}
