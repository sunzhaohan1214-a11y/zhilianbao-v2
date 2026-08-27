import { z } from "zod";
const optionalQuery = z.preprocess((value) => value === null || value === "" ? undefined : value, z.string().trim().optional());
const page = (fallback: number, max: number) => z.preprocess((value) => value == null || value === "" ? fallback : Number(value), z.number().int().min(1).max(max));
export const boundaryCreateSchema = z.object({ areaId: z.uuid(), geoJson: z.unknown(), sourceFilename: z.string().trim().max(255).optional(), reason: z.string().trim().min(1).max(500) }).strict();
export const boundaryActivateSchema = z.object({ reason: z.string().trim().min(1).max(500), confirmation: z.literal("ACTIVATE") }).strict();
export const coordinateSchema = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), reason: z.string().trim().min(1).max(500) }).strict();
export const enterpriseMapDetailQuerySchema = z.object({ page: page(1, 1000000), pageSize: page(50, 100) }).strict();
export const enterpriseMapPointsQuerySchema = enterpriseMapDetailQuerySchema.extend({ areaId: z.uuid() }).strict();
export const memberMapQuerySchema = z.object({ kind: optionalQuery.pipe(z.enum(["current", "alumni"]).default("current")), dispatchOrganizationId: optionalQuery.pipe(z.uuid().optional()), keyword: optionalQuery.pipe(z.string().max(100).optional()) }).strict();
