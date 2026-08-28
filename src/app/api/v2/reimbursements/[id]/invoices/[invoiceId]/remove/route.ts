import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { reimbursementRequestContext } from "@/lib/api/reimbursement-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; invoiceId: string }> }) {
  const c = buildAuthRequestContext(request);
  try {
    const { id, invoiceId } = await params;
    const { actor, context, service } = await reimbursementRequestContext(request, true);
    return apiSuccess(await service.removeInvoice({ actor, context, reimbursementId: id, invoiceId }), c.requestId);
  } catch (error) {
    return apiError(error, c.requestId);
  }
}
