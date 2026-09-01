"use client";

import { Button, ErrorState } from "@/components/ui";

export default function AdminError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorState action={<Button onClick={() => retry()}>重新加载</Button>} description="当前管理页面未能完成加载，重试不会重复提交业务操作。" title="管理页面暂时不可用" />;
}
