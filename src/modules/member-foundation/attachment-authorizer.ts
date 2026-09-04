import type { AttachmentParentAuthorizerRegistry } from "@/modules/attachment/parent-authorization";
import { MemberService } from "./member-service";

const MEMBER_PHOTO_RELATIONS = new Set(["AVATAR", "SOURCE_ATTACHMENT"]);

export function registerMemberAttachmentAuthorizer(registry: AttachmentParentAuthorizerRegistry) {
  registry.register("PERSON", {
    async authorize({ actor, link }) {
      if (!MEMBER_PHOTO_RELATIONS.has(link.relationType)) return false;
      try {
        await new MemberService().detail({ actor, personId: link.entityId });
        return true;
      } catch {
        return false;
      }
    },
  });
}
