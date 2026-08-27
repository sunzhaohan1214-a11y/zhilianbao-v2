export function validateCoordinatePair(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}
export function isEnterpriseResponsibleAreaType(type: string): boolean {
  return ["TOWNSHIP", "PARK", "HIGH_TECH_ZONE", "DEVELOPMENT_ZONE"].includes(type);
}
