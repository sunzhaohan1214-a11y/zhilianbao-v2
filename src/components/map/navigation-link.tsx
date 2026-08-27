"use client";
import { TencentNavigationAdapter } from "@/modules/map/navigation-adapter";
export function NavigationLink({ name, address, latitude, longitude }: { name: string; address: string; latitude?: number | null; longitude?: number | null }) {
  const intent = new TencentNavigationAdapter().createIntent({ name, address, latitude, longitude });
  if (!intent.available) return <span className="text-sm text-slate-400">导航暂不可用</span>;
  return <a href={intent.url} target="_blank" rel="noreferrer" className="text-sm font-medium text-blue-600">导航</a>;
}
