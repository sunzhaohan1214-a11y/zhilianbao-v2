import { createHash } from "node:crypto";
import { MapError } from "./errors";

export const MAX_GEOJSON_BYTES = 5 * 1024 * 1024;
type Position = [number, number, ...number[]];
type PolygonCoordinates = Position[][];
type Geometry = { type: "Polygon"; coordinates: PolygonCoordinates } | { type: "MultiPolygon"; coordinates: PolygonCoordinates[] };
export type ValidGeoJson = Geometry | { type: "Feature"; geometry: Geometry; properties?: Record<string, unknown> | null } | { type: "FeatureCollection"; features: Array<{ type: "Feature"; geometry: Geometry; properties?: Record<string, unknown> | null }> };

function invalid(message: string): never { throw new MapError("MAP_GEOJSON_INVALID", message, 422); }
function validatePosition(value: unknown): asserts value is Position {
  if (!Array.isArray(value) || value.length < 2 || !value.every((part) => typeof part === "number" && Number.isFinite(part))) invalid("坐标点结构不合法");
  const [longitude, latitude] = value;
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) invalid("经纬度超出合法范围");
}
function validatePolygon(value: unknown): asserts value is PolygonCoordinates {
  if (!Array.isArray(value) || value.length === 0) invalid("Polygon 坐标不能为空");
  for (const ring of value) {
    if (!Array.isArray(ring) || ring.length < 4) invalid("Polygon 环至少需要四个坐标点");
    ring.forEach(validatePosition);
    const first = ring[0]; const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) invalid("Polygon 环必须闭合");
  }
}
function validateGeometry(value: unknown): asserts value is Geometry {
  if (!value || typeof value !== "object") invalid("geometry 不能为空");
  const geometry = value as Record<string, unknown>;
  if (geometry.type === "Polygon") validatePolygon(geometry.coordinates);
  else if (geometry.type === "MultiPolygon") {
    if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) invalid("MultiPolygon 坐标不能为空");
    geometry.coordinates.forEach(validatePolygon);
  } else invalid("仅支持 Polygon 或 MultiPolygon geometry");
}
function validateFeature(value: unknown): void {
  if (!value || typeof value !== "object" || (value as Record<string, unknown>).type !== "Feature") invalid("Feature 结构不合法");
  validateGeometry((value as Record<string, unknown>).geometry);
}
export function parseAndValidateGeoJson(value: unknown): { geoJson: ValidGeoJson; checksum: string; bytes: number } {
  let parsed: unknown = value;
  if (typeof value === "string") {
    if (Buffer.byteLength(value, "utf8") > MAX_GEOJSON_BYTES) invalid("GeoJSON 超过 5MB 上限");
    if (/<\/?(?:script|html|iframe|object|embed)\b/i.test(value)) invalid("GeoJSON 不得包含脚本或 HTML");
    try { parsed = JSON.parse(value); } catch { invalid("GeoJSON 不是有效 JSON"); }
  }
  let canonical: string;
  try { canonical = JSON.stringify(parsed); } catch { invalid("GeoJSON 无法序列化"); }
  const bytes = Buffer.byteLength(canonical, "utf8");
  if (bytes === 0 || bytes > MAX_GEOJSON_BYTES) invalid(bytes === 0 ? "GeoJSON 不能为空" : "GeoJSON 超过 5MB 上限");
  if (/<\/?(?:script|html|iframe|object|embed)\b/i.test(canonical)) invalid("GeoJSON 不得包含脚本或 HTML");
  if (!parsed || typeof parsed !== "object") invalid("GeoJSON 根节点不合法");
  const root = parsed as Record<string, unknown>;
  if (root.type === "FeatureCollection") {
    if (!Array.isArray(root.features) || root.features.length === 0) invalid("FeatureCollection 不能为空");
    root.features.forEach(validateFeature);
  } else if (root.type === "Feature") validateFeature(root);
  else validateGeometry(root);
  return { geoJson: parsed as ValidGeoJson, checksum: createHash("sha256").update(canonical).digest("hex"), bytes };
}

export function geoJsonCenter(value: unknown): { latitude: number; longitude: number } | null {
  const positions: Position[] = [];
  const visit = (node: unknown) => {
    if (!Array.isArray(node)) return;
    if (node.length >= 2 && typeof node[0] === "number" && typeof node[1] === "number") { positions.push(node as Position); return; }
    node.forEach(visit);
  };
  const roots = (() => {
    if (!value || typeof value !== "object") return [];
    const root = value as Record<string, unknown>;
    if (root.type === "FeatureCollection" && Array.isArray(root.features)) return root.features.map((item) => (item as Record<string, unknown>).geometry);
    if (root.type === "Feature") return [root.geometry];
    return [root];
  })();
  roots.forEach((item) => visit((item as Record<string, unknown>)?.coordinates));
  if (!positions.length) return null;
  return { longitude: positions.reduce((sum, point) => sum + point[0], 0) / positions.length, latitude: positions.reduce((sum, point) => sum + point[1], 0) / positions.length };
}
