import { validateCoordinatePair } from "./validators";

export type NavigationTarget = { name: string; address: string; latitude?: number | null; longitude?: number | null };
export type NavigationIntent = { available: true; url: string } | { available: false; reason: "MISSING_DESTINATION" };

export interface NavigationAdapter { createIntent(target: NavigationTarget): NavigationIntent }

export class TencentNavigationAdapter implements NavigationAdapter {
  createIntent(target: NavigationTarget): NavigationIntent {
    const name = target.name.trim(); const address = target.address.trim();
    const referer = "zhilianbao";
    if (target.latitude != null && target.longitude != null && validateCoordinatePair(target.latitude, target.longitude)) {
      const marker = `coord:${target.latitude},${target.longitude};title:${name || address};addr:${address}`;
      return { available: true, url: `https://apis.map.qq.com/uri/v1/marker?marker=${encodeURIComponent(marker)}&referer=${referer}` };
    }
    if (address) return { available: true, url: `https://apis.map.qq.com/uri/v1/search?keyword=${encodeURIComponent(address)}&region=${encodeURIComponent("全国")}&referer=${referer}` };
    return { available: false, reason: "MISSING_DESTINATION" };
  }
}
