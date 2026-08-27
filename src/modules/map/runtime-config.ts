import { validateCoordinatePair } from "./validators";

export function getMapRuntimeConfig() {
  const key = process.env.NEXT_PUBLIC_TENCENT_MAP_KEY?.trim() || null;
  const latitude = process.env.BAOYING_COUNTY_GOV_LATITUDE ? Number(process.env.BAOYING_COUNTY_GOV_LATITUDE) : null;
  const longitude = process.env.BAOYING_COUNTY_GOV_LONGITUDE ? Number(process.env.BAOYING_COUNTY_GOV_LONGITUDE) : null;
  const landmark = latitude !== null && longitude !== null && validateCoordinatePair(latitude, longitude)
    ? { name: "宝应县政府", latitude, longitude }
    : null;
  return { tencentMapKey: key, countyGovernmentLandmark: landmark, diagnostics: [
    ...(!key ? ["腾讯地图 Key 未配置"] : []),
    ...(!landmark ? ["宝应县政府坐标未配置或无效，红星不会显示"] : []),
  ] };
}
