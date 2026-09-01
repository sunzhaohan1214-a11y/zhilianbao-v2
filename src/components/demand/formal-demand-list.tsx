import Link from "next/link";
import type { FormalDemandService } from "@/modules/demand";
import { Badge, EmptyState, Table, TableBody, TableCell, TableFrame, TableHead, TableHeaderCell, TableRow } from "@/components/ui";
import { listNextStep } from "./demand-next-step";

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

function demandStatus(value: string) {
  return statusLabel[value] ?? "状态待确认";
}

function demandType(value: string) {
  return typeLabel[value] ?? "其他需求";
}

function statusTone(value: string): "neutral" | "brand" | "success" | "warning" | "danger" {
  if (value === "COMPLETED") return "success";
  if (value === "RETURNED" || value === "CANCELED") return "danger";
  if (value === "PENDING_REVIEW" || value === "PENDING_CLOSE_REVIEW") return "warning";
  if (value === "PENDING_CLAIM" || value === "IN_PROGRESS") return "brand";
  return "neutral";
}

export function FormalDemandList({ result, admin = false }: { result: Result; admin?: boolean }) {
  const items = "items" in result ? result.items : [];
  return (
    <div className={admin ? "mt-5" : "mt-5 space-y-3"}>
      {admin ? (
        <>
          <TableFrame>
            <Table>
              <TableHead><TableRow><TableHeaderCell>需求</TableHeaderCell><TableHeaderCell>企业</TableHeaderCell><TableHeaderCell>区域</TableHeaderCell><TableHeaderCell>类型</TableHeaderCell><TableHeaderCell>负责人</TableHeaderCell><TableHeaderCell>状态</TableHeaderCell></TableRow></TableHead>
              <TableBody>{items.map((demand) => <TableRow key={demand.id}><TableCell><Link className="font-semibold text-brand hover:underline" href={`/admin/demands/${demand.id}`}>{demand.businessNo}</Link><p className="mt-1 max-w-sm truncate text-muted">{demand.title}</p><p className="mt-1 max-w-sm text-xs text-tertiary">下一步：{listNextStep(demand.status)}</p></TableCell><TableCell>{demand.enterprise.name}</TableCell><TableCell>{demand.responsibleArea.name}</TableCell><TableCell>{demandType(demand.demandType)}</TableCell><TableCell>{demand.currentOwner?.name ?? "待认领"}</TableCell><TableCell><Badge tone={statusTone(demand.status)}>{demandStatus(demand.status)}</Badge></TableCell></TableRow>)}</TableBody>
            </Table>
          </TableFrame>
          {items.length === 0 && <EmptyState className="mt-3" description="请调整搜索或筛选条件后重试。" title="暂无符合条件的正式需求" />}
        </>
      ) : (
        <>
          {items.map((demand) => <Link key={demand.id} href={`/demands/${demand.id}`} className="block rounded-2xl border border-separator bg-surface p-4 shadow-sm transition hover:border-brand/30 hover:shadow-md"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-semibold text-brand">{demand.businessNo}</p><h3 className="mt-1 font-semibold leading-6 text-foreground">{demand.title}</h3><p className="mt-1 text-sm text-muted">{demand.enterprise.name} · {demand.responsibleArea.name}</p><p className="mt-1 text-xs text-tertiary">负责人：{demand.currentOwner?.name ?? "待认领"}</p><p className="mt-2 text-xs leading-5 text-muted">下一步：{listNextStep(demand.status)}</p></div><Badge className="shrink-0" tone={statusTone(demand.status)}>{demandStatus(demand.status)}</Badge></div></Link>)}
          {items.length === 0 && <EmptyState description="请调整搜索或筛选条件后重试。" title="暂无符合条件的正式需求" />}
        </>
      )}
    </div>
  );
}
