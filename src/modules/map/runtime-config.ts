import { validateCoordinatePair } from "./validators";

export function getMapRuntimeConfig() {
  const latitude = process.env.BAOYING_COUNTY_GOV_LATITUDE ? Number(process.env.BAOYING_COUNTY_GOV_LATITUDE) : null;
  const longitude = process.env.BAOYING_COUNTY_GOV_LONGITUDE ? Number(process.env.BAOYING_COUNTY_GOV_LONGITUDE) : null;
  const landmark = latitude !== null && longitude !== null && validateCoordinatePair(latitude, longitude)
    ? { name: "宝应县政府", latitude, longitude }
    : null;
  return { tencentMapKey: null, countyGovernmentLandmark: landmark, diagnostics: [
    "外部付费地图 SDK 已禁用，使用本地 GeoJSON 示意图",
    ...(!landmark ? ["宝应县政府坐标未配置或无效，红星不会显示"] : []),
  ] };
}
