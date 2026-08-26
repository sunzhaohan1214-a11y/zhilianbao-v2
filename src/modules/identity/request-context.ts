export type AuthRequestContext = {
  ip: string;
  userAgent: string;
  deviceId: string;
  deviceName: string;
  requestId: string;
};

export function inferDeviceName(userAgent: string): string {
  if (/iPhone|iPad/i.test(userAgent)) return "iPhone / iPad";
  if (/Android/i.test(userAgent)) return "Android";
  if (/Edg\//i.test(userAgent)) return "Edge";
  if (/Chrome\//i.test(userAgent)) return "Chrome";
  if (/Safari\//i.test(userAgent)) return "Safari";
  return "未知浏览器";
}
