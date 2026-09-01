"use client";

import { Button, ErrorState } from "@/components/ui";

export default function MobileError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorState action={<Button onClick={() => retry()}>重新加载</Button>} description="请检查网络后重试；如果问题持续，请联系管理员。" title="页面暂时无法加载" />;
}
