"use client";
import { useEffect, useRef, useState } from "react";
import { LocalMapRenderer, type BoundaryShape, type MapPoint } from "@/modules/map/client/map-renderer";

export function MapCanvas({ mapKey, center, boundaries, points, emptyMessage = "暂无可显示的地图数据" }: { mapKey: string | null; center?: { latitude: number; longitude: number } | null; boundaries: BoundaryShape[]; points: MapPoint[]; emptyMessage?: string }) {
  const ref = useRef<HTMLDivElement>(null); const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  useEffect(() => {
    if (!ref.current || (!center && !points.length && !boundaries.length)) return; const renderer = new LocalMapRenderer(); let active = true; setStatus("loading");
    renderer.render({ container: ref.current, center: center ?? undefined, boundaries, points }).then(() => active && setStatus("ready")).catch(() => active && setStatus("error"));
    return () => { active = false; renderer.destroy(); };
  }, [mapKey, center, boundaries, points]);
  if ((!boundaries.length && !points.length) || (!center && !points.length)) return <div className="grid min-h-72 place-items-center rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">{emptyMessage}</div>;
  return <div className="relative min-h-72 overflow-hidden rounded-3xl bg-slate-100"><div ref={ref} className="absolute inset-0" aria-label="本地地图示意图" />{status === "loading" && <div className="absolute inset-0 grid place-items-center bg-white/70 text-sm text-slate-500">地图加载中…</div>}{status === "error" && <div data-testid="map-load-error" className="absolute inset-0 grid place-items-center bg-white/90 p-6 text-center text-sm text-slate-600">地图数据绘制失败，列表仍可正常使用。</div>}</div>;
}
