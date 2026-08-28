import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { formalDemandRequestContext } from "@/lib/api/formal-demand-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){const context=buildAuthRequestContext(request);try{const{actor,lifecycle}=await formalDemandRequestContext(request,true);return apiSuccess(await lifecycle.reviewOwnerExit({actor,context,demandId:(await params).id,body:await request.json()}),context.requestId);}catch(error){return apiError(error,context.requestId);}}
