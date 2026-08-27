import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api/response";
import { setDeviceCookie } from "@/lib/auth/cookies";
import { assertTrustedMutationOrigin } from "@/lib/auth/origin";
import { buildAuthRequestContext, getDeviceId } from "@/lib/auth/request-context";
import { getAttachmentRuntime } from "@/modules/attachment/runtime";
import { uploadIntentSchema } from "@/modules/attachment/schemas";
import { DemandLeadService } from "@/modules/demand";

const publicUploadIntentSchema = uploadIntentSchema.extend({ responsibleAreaId: z.uuid() }).strict();

export async function POST(request: NextRequest) {
  const deviceId = getDeviceId(request);
  const context = buildAuthRequestContext(request, deviceId);
  try {
    assertTrustedMutationOrigin(request);
    const input = publicUploadIntentSchema.parse(await request.json());
    await new DemandLeadService().validatePublicArea(input.responsibleAreaId);
    const response = apiSuccess(
      await getAttachmentRuntime().service.createPublicUploadIntent(input),
      context.requestId,
      201,
    );
    setDeviceCookie(response, deviceId);
    return response;
  } catch (error) {
    const response = apiError(error, context.requestId);
    setDeviceCookie(response, deviceId);
    return response;
  }
}
