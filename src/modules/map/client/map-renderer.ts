export type MapPoint = { id: string; name: string; latitude: number; longitude: number; color?: "red" | "blue"; label?: string };
export type BoundaryShape = { id: string; geoJson: unknown };
export type RenderMapInput = { container: HTMLElement; center?: { latitude: number; longitude: number }; points: MapPoint[]; boundaries: BoundaryShape[] };
export interface MapRenderer { render(input: RenderMapInput): Promise<void>; destroy(): void }

export function resolveMapCenter(input: Pick<RenderMapInput, "center" | "points">) {
  const first = input.points[0];
  return input.center ?? (first ? { latitude: first.latitude, longitude: first.longitude } : null);
}

type Coordinate = [number, number];

function coordinateRings(root: unknown): Coordinate[][] {
  if (!root || typeof root !== "object") return [];
  const value = root as Record<string, unknown>;
  if (value.type === "FeatureCollection" && Array.isArray(value.features)) return value.features.flatMap(coordinateRings);
  if (value.type === "Feature") return coordinateRings(value.geometry);
  if (value.type === "Polygon" && Array.isArray(value.coordinates)) return value.coordinates.filter(Array.isArray) as Coordinate[][];
  if (value.type === "MultiPolygon" && Array.isArray(value.coordinates)) {
    return value.coordinates.flatMap((polygon) => Array.isArray(polygon) ? polygon.filter(Array.isArray) as Coordinate[][] : []);
  }
  return [];
}

export class LocalMapRenderer implements MapRenderer {
  private container: HTMLElement | null = null;

  async render(input: RenderMapInput) {
    this.destroy();
    this.container = input.container;
    const rings = input.boundaries.flatMap((boundary) => coordinateRings(boundary.geoJson));
    const coordinates = [
      ...rings.flat(),
      ...input.points.map((point) => [point.longitude, point.latitude] as Coordinate),
    ].filter(([longitude, latitude]) => Number.isFinite(longitude) && Number.isFinite(latitude));
    if (coordinates.length === 0) throw new Error("Map coordinates unavailable");

    const longitudes = coordinates.map(([longitude]) => longitude);
    const latitudes = coordinates.map(([, latitude]) => latitude);
    const minLongitude = Math.min(...longitudes); const maxLongitude = Math.max(...longitudes);
    const minLatitude = Math.min(...latitudes); const maxLatitude = Math.max(...latitudes);
    const longitudeSpan = Math.max(maxLongitude - minLongitude, 0.01);
    const latitudeSpan = Math.max(maxLatitude - minLatitude, 0.01);
    const project = ([longitude, latitude]: Coordinate) => ({
      x: 32 + ((longitude - minLongitude) / longitudeSpan) * 736,
      y: 32 + ((maxLatitude - latitude) / latitudeSpan) * 416,
    });

    const svgNamespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNamespace, "svg");
    svg.setAttribute("viewBox", "0 0 800 480");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "基于本地 GeoJSON 绘制的区域与点位示意图");
    svg.classList.add("h-full", "w-full");

    const background = document.createElementNS(svgNamespace, "rect");
    background.setAttribute("width", "800"); background.setAttribute("height", "480");
    background.setAttribute("fill", "#f1f5f9"); svg.appendChild(background);

    for (const ring of rings) {
      const polygon = document.createElementNS(svgNamespace, "polygon");
      polygon.setAttribute("points", ring.map((coordinate) => { const point = project(coordinate); return `${point.x},${point.y}`; }).join(" "));
      polygon.setAttribute("fill", "rgba(66,109,122,0.14)"); polygon.setAttribute("stroke", "#426d7a"); polygon.setAttribute("stroke-width", "2");
      svg.appendChild(polygon);
    }

    for (const point of input.points) {
      const projected = project([point.longitude, point.latitude]);
      const group = document.createElementNS(svgNamespace, "g");
      const marker = document.createElementNS(svgNamespace, "circle");
      marker.setAttribute("cx", String(projected.x)); marker.setAttribute("cy", String(projected.y)); marker.setAttribute("r", "8");
      marker.setAttribute("fill", point.color === "red" ? "#dc2626" : "#426d7a"); marker.setAttribute("stroke", "white"); marker.setAttribute("stroke-width", "2");
      const title = document.createElementNS(svgNamespace, "title"); title.textContent = point.name; group.append(marker, title); svg.appendChild(group);
    }
    input.container.replaceChildren(svg);
  }

  destroy() { this.container?.replaceChildren(); this.container = null; }
}

export class FakeMapRenderer implements MapRenderer { calls: RenderMapInput[] = []; async render(input: RenderMapInput) { this.calls.push(input); } destroy() { this.calls = []; } }
