import { AuthError } from "@/modules/identity/errors";

function expectedOrigins(request: Request): Set<string> {
  const url = new URL(request.url);
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  const host = request.headers.get("x-forwarded-host")?.split(",")[0].trim()
    ?? request.headers.get("host")
    ?? url.host;
  const origins = new Set([`${forwardedProto ?? url.protocol.replace(":", "")}://${host}`, url.origin]);
  if (process.env.APP_BASE_URL) origins.add(new URL(process.env.APP_BASE_URL).origin);
  return origins;
}

export function assertTrustedMutationOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  let candidate = origin;
  if (!candidate && referer) {
    try {
      candidate = new URL(referer).origin;
    } catch {
      candidate = null;
    }
  }
  if (!candidate || !expectedOrigins(request).has(candidate)) {
    throw new AuthError("UNTRUSTED_ORIGIN", "请求来源校验失败", 403);
  }
}
