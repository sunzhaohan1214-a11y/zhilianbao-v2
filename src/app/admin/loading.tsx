import { Skeleton, SkeletonCard } from "@/components/ui";

export default function AdminLoading() {
  return <div aria-label="管理页面加载中" className="space-y-6" role="status"><Skeleton className="h-9 w-52" /><Skeleton className="h-4 w-96 max-w-full" /><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div><span className="sr-only">管理页面加载中</span></div>;
}
