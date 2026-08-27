import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { setDeviceCookie } from "@/lib/auth/cookies";
import { assertTrustedMutationOrigin } from "@/lib/auth/origin";
import { buildAuthRequestContext, getDeviceId } from "@/lib/auth/request-context";
import { DemandLeadService } from "@/modules/demand";

export async function POST(request: NextRequest) {
  const deviceId = getDeviceId(request);
  const context = buildAuthRequestContext(request, deviceId);
  try {
    assertTrustedMutationOrigin(request);
    const service = new DemandLeadService();
    const data = await service.createPublic({
      payload: await request.json(),
      idempotencyKey: request.headers.get("idempotency-key"),
      rateLimit: { ip: context.ip, deviceId },
      context,
    });
    const response = apiSuccess(data, context.requestId, 201);
    setDeviceCookie(response, deviceId);
    return response;
  } catch (error) {
    const response = apiError(error, context.requestId);
    setDeviceCookie(response, deviceId);
    return response;
  }
}
