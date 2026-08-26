import { AuthError } from "@/modules/identity/errors";

function expectedOrigins(request: Request): Set<string> {
  const configuredBaseUrl = process.env.APP_BASE_URL;
  if (process.env.NODE_ENV === "production") {
    if (!configuredBaseUrl) throw new Error("APP_BASE_URL is required in production");
    return new Set([new URL(configuredBaseUrl).origin]);
  }

  const origins = new Set([new URL(request.url).origin]);
  if (configuredBaseUrl) origins.add(new URL(configuredBaseUrl).origin);
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
  let candidateOrigin: string | null = null;
  if (candidate) {
    try {
      candidateOrigin = new URL(candidate).origin;
    } catch {
      candidateOrigin = null;
    }
  }
  if (!candidateOrigin || !expectedOrigins(request).has(candidateOrigin)) {
    throw new AuthError("UNTRUSTED_ORIGIN", "请求来源校验失败", 403);
  }
}
