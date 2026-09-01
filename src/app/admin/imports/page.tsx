import Link from "next/link";
import { Badge, EmptyState, PageHeader, Table, TableBody, TableCell, TableFrame, TableHead, TableHeaderCell, TableRow, buttonStyles } from "@/components/ui";
import { importPageContext } from "@/lib/import-export/page-context";

const typeLabel: Record<string, string> = { ENTERPRISE: "企业", MEMBER: "团员", TALENT: "人才" };
const statusLabel: Record<string, string> = {
  UPLOADED: "文件已上传", PARSING: "正在解析", MAPPING_REQUIRED: "待字段映射", PREVIEW_READY: "预览已就绪",
  APPLYING: "正在导入", SUCCEEDED: "导入成功", FAILED: "导入失败", CANCELED: "已取消",
};

function tone(status: string): "neutral" | "brand" | "success" | "warning" | "danger" {
  if (status === "SUCCEEDED") return "success";
  if (status === "FAILED") return "danger";
  if (["PARSING", "APPLYING"].includes(status)) return "brand";
  if (["MAPPING_REQUIRED", "PREVIEW_READY"].includes(status)) return "warning";
  return "neutral";
}

export default async function ImportBatchPage() {
  const { actor, service } = await importPageContext();
  const result = await service.list({ actor, query: { page: 1, pageSize: 100 } });
  return (
    <section>
      <PageHeader actions={<Link className={buttonStyles()} href="/admin/imports/new">新建导入</Link>} description="安全扫描、字段映射、整批预览、人工处理与原子确认。" eyebrow="数据管理" title="数据导入" />
      <div className="mt-7">
        <TableFrame>
          <Table>
            <TableHead><TableRow><TableHeaderCell>文件名</TableHeaderCell><TableHeaderCell>类型</TableHeaderCell><TableHeaderCell>状态</TableHeaderCell><TableHeaderCell>创建人</TableHeaderCell><TableHeaderCell>总行数</TableHeaderCell><TableHeaderCell>待确认</TableHeaderCell><TableHeaderCell>结果</TableHeaderCell><TableHeaderCell>时间</TableHeaderCell></TableRow></TableHead>
            <TableBody>{result.items.map((item) => <TableRow key={item.id}><TableCell><Link href={`/admin/imports/${item.id}`} className="font-semibold text-brand hover:underline">{item.originalFilename}</Link></TableCell><TableCell>{typeLabel[item.importType] ?? "其他"}</TableCell><TableCell><Badge tone={tone(item.status)}>{statusLabel[item.status] ?? "状态待确认"}</Badge></TableCell><TableCell>{item.createdByPerson.name}</TableCell><TableCell>{item.rowCount}</TableCell><TableCell>{item.blockingRowCount}</TableCell><TableCell>{["PREVIEW_READY", "SUCCEEDED", "FAILED"].includes(item.status) ? <a className="font-medium text-brand hover:underline" href={`/api/v2/admin/imports/${item.id}/result.xlsx`}>下载报告</a> : "—"}</TableCell><TableCell>{item.createdAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</TableCell></TableRow>)}</TableBody>
          </Table>
        </TableFrame>
        {result.items.length === 0 && <EmptyState className="mt-4" description="新建导入后，批次会显示在这里。" title="暂无导入批次" />}
      </div>
    </section>
  );
}
