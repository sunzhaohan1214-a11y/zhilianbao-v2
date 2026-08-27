import { z } from "zod";

const audienceRuleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ALL") }).strict(),
  z.object({ type: z.literal("ROLE"), roleCode: z.enum(["MEMBER_CURRENT", "MEMBER_ALUMNI_PLATFORM", "GROUP_LEADER", "MINISTER", "TOWNSHIP_STAFF", "DEPARTMENT_STAFF", "ADMIN", "SUPER_ADMIN", "LEADER_STAGE2"]) }).strict(),
  z.object({ type: z.literal("ADMINISTRATIVE_AREA"), areaId: z.uuid() }).strict(),
  z.object({ type: z.literal("ORGANIZATION"), organizationId: z.uuid() }).strict(),
  z.object({ type: z.literal("PERSON"), personId: z.uuid() }).strict(),
]);

export const announcementContentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(100_000),
  isImportant: z.boolean().default(false),
  needConfirm: z.boolean().default(false),
  attachmentIds: z.array(z.uuid()).max(20).default([]).transform((ids) => [...new Set(ids)]),
});

export const createAnnouncementSchema = announcementContentSchema.extend({
  audience: z.array(audienceRuleSchema).min(1).max(100),
}).strict();

export const updateAnnouncementSchema = announcementContentSchema.extend({
  reason: z.string().trim().min(2).max(500),
}).strict();

export const updateAnnouncementAudienceSchema = z.object({
  audience: z.array(audienceRuleSchema).min(1).max(100),
  reason: z.string().trim().min(2).max(500),
}).strict();

export const withdrawAnnouncementSchema = z.object({ reason: z.string().trim().min(2).max(500) }).strict();
export const pinAnnouncementSchema = z.object({ pinned: z.boolean().default(true) }).strict();
export const announcementListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

export type AnnouncementAudienceInput = z.infer<typeof audienceRuleSchema>;
