import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  SkeletonCard,
  Table,
  TableBody,
  TableCell,
  TableFrame,
  TableHead,
  TableHeaderCell,
  TableRow,
  cn,
} from "@/components/ui";

describe("UI foundation", () => {
  it("keeps controls touch-sized and exposes loading semantics", () => {
    const html = renderToStaticMarkup(<Button isLoading>保存</Button>);
    expect(html).toContain("min-h-11");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("disabled");
  });

  it("marks invalid fields without relying on color alone", () => {
    const html = renderToStaticMarkup(<Input aria-describedby="phone-error" invalid name="phone" />);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="phone-error"');
  });

  it("renders explicit empty, error, loading and status text", () => {
    const empty = renderToStaticMarkup(<EmptyState description="调整筛选条件后重试" title="暂无结果" />);
    const error = renderToStaticMarkup(<ErrorState description="请检查网络后重试" title="加载失败" />);
    const loading = renderToStaticMarkup(<SkeletonCard />);
    const status = renderToStaticMarkup(<Badge tone="warning">待审核</Badge>);
    expect(empty).toContain('role="status"');
    expect(error).toContain('role="alert"');
    expect(loading).toContain("内容加载中");
    expect(status).toContain("待审核");
  });

  it("preserves semantic headings and table structure", () => {
    const header = renderToStaticMarkup(<PageHeader eyebrow="需求中心" title="全部需求" />);
    const table = renderToStaticMarkup(
      <TableFrame><Table><TableHead><TableRow><TableHeaderCell>需求</TableHeaderCell></TableRow></TableHead><TableBody><TableRow><TableCell>测试需求</TableCell></TableRow></TableBody></Table></TableFrame>,
    );
    expect(header).toContain("<h1");
    expect(table).toContain("<table");
    expect(table).toContain('scope="col"');
  });

  it("joins only present class names", () => {
    expect(cn("base", false, undefined, "extra")).toBe("base extra");
  });
});
