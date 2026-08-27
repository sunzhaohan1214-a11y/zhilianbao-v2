import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api/response";
import { setDeviceCookie } from "@/lib/auth/cookies";
import { assertTrustedMutationOrigin } from "@/lib/auth/origin";
import { buildAuthRequestContext, getDeviceId } from "@/lib/auth/request-context";
import { getAttachmentRuntime } from "@/modules/attachment/runtime";

const completePublicAttachmentSchema = z.object({ uploadToken: z.string().min(32).max(200) }).strict();

export async function POST(request: NextRequest, route: { params: Promise<{ id: string }> }) {
  const deviceId = getDeviceId(request);
  const context = buildAuthRequestContext(request, deviceId);
  try {
    assertTrustedMutationOrigin(request);
    const { uploadToken } = completePublicAttachmentSchema.parse(await request.json());
    const { id } = await route.params;
    const response = apiSuccess(
      await getAttachmentRuntime().service.completePublic({ attachmentId: id, uploadToken, context }),
      context.requestId,
    );
    setDeviceCookie(response, deviceId);
    return response;
  } catch (error) {
    const response = apiError(error, context.requestId);
    setDeviceCookie(response, deviceId);
    return response;
  }
}
