import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { reimbursementRequestContext } from "@/lib/api/reimbursement-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
import { reimbursementDraftSchema, reimbursementListQuerySchema } from "@/modules/reimbursement/schemas";
export async function GET(request: NextRequest) { const c = buildAuthRequestContext(request); try { const { actor, context, service } = await reimbursementRequestContext(request); const query = reimbursementListQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams)); return apiSuccess(await service.list({ actor, context, query }), c.requestId); } catch (e) { return apiError(e, c.requestId); } }
export async function POST(request: NextRequest) { const c = buildAuthRequestContext(request); try { const { actor, context, service } = await reimbursementRequestContext(request, true); const body = reimbursementDraftSchema.parse(await request.json()); return apiSuccess(await service.create({ actor, context, body }), c.requestId, 201); } catch (e) { return apiError(e, c.requestId); } }
