import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requireRequestSession } from "@/lib/auth/current-session";
import { assertTrustedMutationOrigin } from "@/lib/auth/origin";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
import { getPrismaClient } from "@/lib/db/prisma";
import { authorizeActor } from "@/modules/permissions/authorization";
import { resolvePermissionActor } from "@/modules/permissions/actor-resolver";

const schema = z.object({
  areas: z.array(z.object({
    name: z.string().trim().min(1).max(100),
    type: z.enum(["TOWNSHIP", "PARK", "HIGH_TECH_ZONE", "DEVELOPMENT_ZONE"]),
  }).strict()).min(1).max(50),
}).strict();

export async function POST(request: NextRequest) {
  const context = buildAuthRequestContext(request);
  if (!["test", "testing", "uat", "staging"].includes((process.env.APP_ENV ?? "").trim().toLowerCase())) {
    return new Response(null, { status: 404 });
  }
  try {
    assertTrustedMutationOrigin(request);
    const session = await requireRequestSession(request);
    const actor = await resolvePermissionActor(session);
    await authorizeActor({ actor, action: "system.high_privilege_manage", resource: { resourceType: "system", requiredScope: "SYSTEM" } });
    const input = schema.parse(await request.json());
    const prisma = getPrismaClient();
    let created = 0;
    let existing = 0;
    for (const area of input.areas) {
      const found = await prisma.administrativeArea.findFirst({ where: { name: area.name, type: area.type, status: "ACTIVE" }, select: { id: true } });
      if (found) { existing += 1; continue; }
      await prisma.administrativeArea.create({ data: area });
      created += 1;
    }
    return apiSuccess({ created, existing, total: input.areas.length }, context.requestId, 201);
  } catch (error) {
    return apiError(error, context.requestId);
  }
}
