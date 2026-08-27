import { describe, expect, it } from "vitest";
import { createAnnouncementSchema, updateAnnouncementAudienceSchema } from "@/modules/announcement/schemas";
import { OUTBOX_EVENT_TYPES, outboxPayloadSchemas } from "@/modules/outbox/outbox-types";
import { resolveCapabilities } from "@/modules/permissions/role-capabilities";

describe("C-M3-003 announcement and notification foundation", () => {
  it("validates each supported audience target without accepting mixed target fields", () => {
    const common = { title: "公告", body: "正文", attachmentIds: [] };
    for (const rule of [
      { type: "ALL" },
      { type: "ROLE", roleCode: "ADMIN" },
      { type: "ADMINISTRATIVE_AREA", areaId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      { type: "ORGANIZATION", organizationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
      { type: "PERSON", personId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
    ]) expect(() => createAnnouncementSchema.parse({ ...common, audience: [rule] })).not.toThrow();
    expect(() => updateAnnouncementAudienceSchema.parse({
      audience: [{ type: "PERSON", personId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", organizationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }],
      reason: "非法混合目标",
    })).toThrow();
  });

  it("declares strict schemas for every emitted event and keeps future contracts out of runtime", () => {
    expect(OUTBOX_EVENT_TYPES).toEqual(expect.arrayContaining([
      "ANNOUNCEMENT_PUBLISHED", "ANNOUNCEMENT_UPDATED", "ANNOUNCEMENT_AUDIENCE_ADDED",
      "ANNOUNCEMENT_AUDIENCE_REMOVED", "ANNOUNCEMENT_WITHDRAWN", "HELP_REASSIGNED",
    ]));
    expect(OUTBOX_EVENT_TYPES).not.toContain("TRIP_PARTICIPANT_ADDED");
    expect(outboxPayloadSchemas.ANNOUNCEMENT_PUBLISHED.safeParse({
      announcementId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      versionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      recipientIds: ["cccccccc-cccc-4ccc-8ccc-cccccccccccc", "cccccccc-cccc-4ccc-8ccc-cccccccccccc"],
      needConfirm: true,
      eventKey: "v1",
    }).data?.recipientIds).toEqual(["cccccccc-cccc-4ccc-8ccc-cccccccccccc"]);
  });

  it("keeps announcement, self-message and self-todo capabilities on all internal actors", () => {
    const capabilities = resolveCapabilities(["MEMBER_ALUMNI_PLATFORM"], new Set());
    expect([...capabilities]).toEqual(expect.arrayContaining([
      "announcement.view", "announcement.confirm", "message.view.self", "message.read.self", "todo.view.self",
    ]));
  });
});
