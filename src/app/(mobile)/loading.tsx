import { Skeleton, SkeletonCard } from "@/components/ui";

export default function MobileLoading() {
  return <div aria-label="页面加载中" className="space-y-5" role="status"><Skeleton className="h-8 w-32" /><Skeleton className="h-4 w-56" /><SkeletonCard /><SkeletonCard /><span className="sr-only">页面加载中</span></div>;
}
