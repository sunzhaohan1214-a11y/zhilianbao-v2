export type MapPoint = { id: string; name: string; latitude: number; longitude: number; color?: "red" | "blue"; label?: string };
export type BoundaryShape = { id: string; geoJson: unknown };
export type RenderMapInput = { container: HTMLElement; center?: { latitude: number; longitude: number }; points: MapPoint[]; boundaries: BoundaryShape[] };
export interface MapRenderer { render(input: RenderMapInput): Promise<void>; destroy(): void }

type TMapApi = {
  LatLng: new (latitude: number, longitude: number) => unknown;
  Map: new (container: HTMLElement, options: Record<string, unknown>) => { destroy?: () => void; fitBounds?: (bounds: unknown) => void };
  MultiMarker: new (options: Record<string, unknown>) => { setMap?: (map: null) => void };
  MultiPolygon: new (options: Record<string, unknown>) => { setMap?: (map: null) => void };
};
declare global { interface Window { TMap?: TMapApi; __tencentMapLoading?: Promise<TMapApi> } }

function loadTencentMap(key: string): Promise<TMapApi> {
  if (window.TMap) return Promise.resolve(window.TMap);
  if (window.__tencentMapLoading) return window.__tencentMapLoading;
  window.__tencentMapLoading = new Promise<TMapApi>((resolve, reject) => {
    const script = document.createElement("script"); script.async = true; script.defer = true;
    script.src = `https://map.qq.com/api/gljs?v=1.exp&key=${encodeURIComponent(key)}`;
    script.onload = () => window.TMap ? resolve(window.TMap) : reject(new Error("TMap unavailable"));
    script.onerror = () => reject(new Error("Tencent map SDK load failed")); document.head.appendChild(script);
  });
  return window.__tencentMapLoading;
}
function geometries(root: unknown): Array<{ type: string; coordinates: unknown }> {
  if (!root || typeof root !== "object") return [];
  const value = root as Record<string, unknown>;
  if (value.type === "FeatureCollection" && Array.isArray(value.features)) return value.features.flatMap(geometries);
  if (value.type === "Feature") return geometries(value.geometry);
  return value.type === "Polygon" || value.type === "MultiPolygon" ? [{ type: value.type, coordinates: value.coordinates }] : [];
}
function polygonPaths(TMap: TMapApi, shape: BoundaryShape) {
  const paths: Array<{ id: string; paths: unknown[]; styleId: string }> = [];
  geometries(shape.geoJson).forEach((geometry, geometryIndex) => {
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    if (!Array.isArray(polygons)) return;
    polygons.forEach((polygon, polygonIndex) => {
      if (!Array.isArray(polygon)) return;
      const rings = polygon.map((ring) => Array.isArray(ring) ? ring.map((coordinate) => Array.isArray(coordinate) ? new TMap.LatLng(Number(coordinate[1]), Number(coordinate[0])) : null).filter(Boolean) : []);
      paths.push({ id: `${shape.id}-${geometryIndex}-${polygonIndex}`, paths: rings, styleId: "boundary" });
    });
  });
  return paths;
}
export class TencentMapRenderer implements MapRenderer {
  private map: { destroy?: () => void } | null = null; private layers: Array<{ setMap?: (map: null) => void }> = [];
  constructor(private readonly key: string) {}
  async render(input: RenderMapInput) {
    const TMap = await loadTencentMap(this.key); this.destroy();
    const first = input.points[0]; const center = input.center ?? (first ? { latitude: first.latitude, longitude: first.longitude } : { latitude: 33.24, longitude: 119.36 });
    this.map = new TMap.Map(input.container, { center: new TMap.LatLng(center.latitude, center.longitude), zoom: input.boundaries.length ? 10 : 5, viewMode: "2D" });
    if (input.boundaries.length) this.layers.push(new TMap.MultiPolygon({ map: this.map, styles: { boundary: { color: "rgba(22,119,255,0.14)", showBorder: true, borderColor: "#1677ff", borderWidth: 2 } }, geometries: input.boundaries.flatMap((shape) => polygonPaths(TMap, shape)) }));
    if (input.points.length) {
      const styles = Object.fromEntries(input.points.map((point) => {
        const red = point.color === "red"; const label = red ? "★" : (point.label ?? "•");
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="32"><rect x="1" y="1" width="42" height="30" rx="15" fill="${red ? "#dc2626" : "#1677ff"}" stroke="white" stroke-width="2"/><text x="22" y="21" text-anchor="middle" fill="white" font-size="14" font-family="Arial">${label}</text></svg>`;
        return [`point-${point.id}`, { width: 44, height: 32, anchor: { x: 22, y: 16 }, src: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}` }];
      }));
      this.layers.push(new TMap.MultiMarker({ map: this.map, styles, geometries: input.points.map((point) => ({ id: point.id, styleId: `point-${point.id}`, position: new TMap.LatLng(point.latitude, point.longitude), properties: { title: point.name } })) }));
    }
  }
  destroy() { this.layers.forEach((layer) => layer.setMap?.(null)); this.layers = []; this.map?.destroy?.(); this.map = null; }
}

export class FakeMapRenderer implements MapRenderer { calls: RenderMapInput[] = []; async render(input: RenderMapInput) { this.calls.push(input); } destroy() { this.calls = []; } }
