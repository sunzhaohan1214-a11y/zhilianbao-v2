import type { DataScope } from "./types";

type ActionDefinition = {
  defaultScope?: DataScope;
  sensitivePermission?: string;
  superAdminOnly?: boolean;
  neverAllow?: boolean;
};

export const ACTION_REGISTRY = {
  "admin.shell.access": { defaultScope: "GLOBAL_OPERATIONAL" },

  "demand.view": { defaultScope: "GLOBAL_PUBLISHED" },
  "demand.lead.create": {},
  "demand.lead.verify": { defaultScope: "TOWNSHIP" },
  "demand.formal.create": { defaultScope: "TOWNSHIP" },
  "demand.submit_review": { defaultScope: "TOWNSHIP" },
  "demand.review": { defaultScope: "GLOBAL_OPERATIONAL" },
  "demand.publish_direct": { defaultScope: "GLOBAL_OPERATIONAL" },
  "demand.claim": {},
  "demand.collaboration.apply": {},
  "demand.collaboration.manage": {},
  "demand.progress.add": {},
  "demand.close.submit": {},
  "demand.close.review": { defaultScope: "GLOBAL_OPERATIONAL" },
  "demand.cancel": {},
  "demand.correct_formal": { defaultScope: "GLOBAL_OPERATIONAL" },
  "demand.recommendation.manage": { defaultScope: "GLOBAL_OPERATIONAL" },
  "demand.owner.transfer": { defaultScope: "SYSTEM", superAdminOnly: true },
  "demand.team_coordinator.remind": { defaultScope: "GLOBAL_PUBLISHED" },
  "demand.outcome.fill": { defaultScope: "TOWNSHIP" },
  "demand.outcome.review": { defaultScope: "GLOBAL_OPERATIONAL" },

  "enterprise.view": { defaultScope: "GLOBAL_PUBLISHED" },
  "enterprise.create_application": { defaultScope: "TOWNSHIP" },
  "enterprise.correct_request": {},
  "enterprise.create_formal": { defaultScope: "GLOBAL_OPERATIONAL" },
  "enterprise.edit_formal": { defaultScope: "GLOBAL_OPERATIONAL" },
  "enterprise.disable": { defaultScope: "GLOBAL_OPERATIONAL" },
  "enterprise.merge": { defaultScope: "GLOBAL_OPERATIONAL" },
  "enterprise.contact.manage": { defaultScope: "TOWNSHIP" },
  "enterprise.map.manage": { defaultScope: "GLOBAL_OPERATIONAL" },

  "member.view": { defaultScope: "GLOBAL_PUBLISHED" },
  "member.profile.self_edit": { defaultScope: "SELF" },
  "member.manage": { defaultScope: "GLOBAL_OPERATIONAL" },
  "member.batch.manage": { defaultScope: "GLOBAL_OPERATIONAL" },
  "member.dispatch_org.manage": { defaultScope: "GLOBAL_OPERATIONAL" },
  "member.map.manage": { defaultScope: "GLOBAL_OPERATIONAL" },
  "group_leader.assign": { defaultScope: "SYSTEM", superAdminOnly: true },
  "minister.assign": { defaultScope: "SYSTEM", superAdminOnly: true },

  "talent.view": { defaultScope: "GLOBAL_PUBLISHED" },
  "talent.submit": {},
  "talent.correct_request": {},
  "talent.review": { defaultScope: "GLOBAL_OPERATIONAL" },
  "talent.edit_formal": { defaultScope: "GLOBAL_OPERATIONAL" },
  "talent.contact.start": { defaultScope: "TOWNSHIP" },
  "talent.contact.update": { defaultScope: "TOWNSHIP" },
  "talent.contact.complete": { defaultScope: "TOWNSHIP" },
  "talent.contact.withdraw": { defaultScope: "TOWNSHIP" },
  "talent.contact_person.change": { defaultScope: "GLOBAL_OPERATIONAL" },
  "talent.merge": { defaultScope: "GLOBAL_OPERATIONAL" },

  "policy.view": { defaultScope: "GLOBAL_PUBLISHED" },
  "policy.create": { defaultScope: "GLOBAL_OPERATIONAL" },
  "policy.edit": { defaultScope: "GLOBAL_OPERATIONAL" },
  "policy.publish": { defaultScope: "GLOBAL_OPERATIONAL" },
  "policy.withdraw": { defaultScope: "GLOBAL_OPERATIONAL" },
  "policy.replacement.manage": { defaultScope: "GLOBAL_OPERATIONAL" },

  "contacts.view": { defaultScope: "GLOBAL_PUBLISHED" },
  "organization.manage": { defaultScope: "GLOBAL_OPERATIONAL" },
  "appointment.manage": { defaultScope: "GLOBAL_OPERATIONAL" },
  "account.basic_manage": { defaultScope: "GLOBAL_OPERATIONAL" },
  "account.high_privilege_manage": { defaultScope: "SYSTEM", superAdminOnly: true },
  "role.high_privilege.assign": { defaultScope: "SYSTEM", superAdminOnly: true },
  "department_township_relation.manage": { defaultScope: "GLOBAL_OPERATIONAL" },

  "presence.report.self": { defaultScope: "SELF" },
  "presence.current.view": { defaultScope: "GLOBAL_PUBLISHED" },
  "presence.current.team_view": { defaultScope: "GLOBAL_PUBLISHED" },
  "presence.history.self_view": { defaultScope: "SELF" },
  "presence.history.admin_view": { defaultScope: "GLOBAL_OPERATIONAL" },
  "presence.correct.admin": { defaultScope: "GLOBAL_OPERATIONAL" },

  "trip.view": {},
  "trip.create": {},
  "trip.team.create": { defaultScope: "GLOBAL_PUBLISHED" },
  "trip.edit": {},
  "trip.cancel": {},
  "trip.result.add": {},
  "trip.correct.admin": { defaultScope: "GLOBAL_OPERATIONAL" },
  "visit.view": {},
  "visit.supplement": {},
  "visit.correct.admin": { defaultScope: "GLOBAL_OPERATIONAL" },
  "visit.lead.create": {},

  "reimbursement.create": { defaultScope: "SELF", sensitivePermission: "reimbursement.apply" },
  "reimbursement.view.self": { defaultScope: "SELF" },
  "reimbursement.edit.self": { defaultScope: "SELF" },
  "reimbursement.submit": { defaultScope: "SELF" },
  "reimbursement.withdraw": { defaultScope: "SELF" },
  "reimbursement.apply.grant": { defaultScope: "GLOBAL_OPERATIONAL" },
  "reimbursement.manage.review": { defaultScope: "REIMBURSEMENT_AUTHORIZED", sensitivePermission: "reimbursement.manage" },
  "reimbursement.manage.return": { defaultScope: "REIMBURSEMENT_AUTHORIZED", sensitivePermission: "reimbursement.manage" },
  "reimbursement.manage.paper_received": { defaultScope: "REIMBURSEMENT_AUTHORIZED", sensitivePermission: "reimbursement.manage" },
  "reimbursement.manage.finance_submitted": { defaultScope: "REIMBURSEMENT_AUTHORIZED", sensitivePermission: "reimbursement.manage" },
  "reimbursement.manage.correct": { defaultScope: "REIMBURSEMENT_AUTHORIZED", sensitivePermission: "reimbursement.manage" },
  "reimbursement.manage.export": { defaultScope: "REIMBURSEMENT_AUTHORIZED", sensitivePermission: "reimbursement.manage" },
  "reimbursement.manage.grant": { defaultScope: "SYSTEM", superAdminOnly: true },

  "help.create": {},
  "help.view": {},
  "help.withdraw": {},
  "help.assign": { defaultScope: "GLOBAL_OPERATIONAL" },
  "help.transfer_to_org": { defaultScope: "GLOBAL_OPERATIONAL" },
  "help.claim": {},
  "help.update": {},
  "help.complete": {},
  "help.reopen": {},
  "help.reassign": { defaultScope: "GLOBAL_OPERATIONAL" },

  "announcement.view": {},
  "announcement.create": { defaultScope: "GLOBAL_OPERATIONAL" },
  "announcement.edit": { defaultScope: "GLOBAL_OPERATIONAL" },
  "announcement.publish": { defaultScope: "GLOBAL_OPERATIONAL" },
  "announcement.scope.change": { defaultScope: "GLOBAL_OPERATIONAL" },
  "announcement.confirm": { defaultScope: "SELF" },
  "announcement.archive": { defaultScope: "GLOBAL_OPERATIONAL" },

  "message.view.self": { defaultScope: "SELF" },
  "message.read.self": { defaultScope: "SELF" },
  "todo.view.self": { defaultScope: "SELF" },
  "todo.complete.by_business": { defaultScope: "SELF" },

  "report.view": {},
  "report.monthly.team_view": { defaultScope: "GLOBAL_PUBLISHED" },
  "report.monthly.team_download": { defaultScope: "GLOBAL_PUBLISHED" },
  "report.monthly.download": {},
  "report.export": {},
  "import.execute": { defaultScope: "GLOBAL_OPERATIONAL" },
  "export.create": {},

  "ai.assistant.use": {},
  "ai.metrics.view": { defaultScope: "GLOBAL_OPERATIONAL" },
  "ai.service.manage": { defaultScope: "SYSTEM", sensitivePermission: "ai.service_manage" },
  "ai.conversation.other_full_view": { neverAllow: true },

  "team.overview.view": { defaultScope: "GLOBAL_PUBLISHED" },
  "attachment.upload": {},
  "attachment.temporary_self_access": { defaultScope: "SELF" },
  "attachment.abort_self": { defaultScope: "SELF" },
  "audit.full_view": { defaultScope: "SYSTEM", superAdminOnly: true },
  "backup.manage": { defaultScope: "SYSTEM", superAdminOnly: true },
  "backup.restore": { defaultScope: "SYSTEM", superAdminOnly: true },
  "system.high_privilege_manage": { defaultScope: "SYSTEM", superAdminOnly: true },
  "system.health.view": { defaultScope: "SYSTEM", superAdminOnly: true },
} as const satisfies Record<string, ActionDefinition>;

export type Capability = keyof typeof ACTION_REGISTRY;

export function isCapability(value: string): value is Capability {
  return Object.hasOwn(ACTION_REGISTRY, value);
}
export function getActionDefinition(action: Capability): ActionDefinition {
  return ACTION_REGISTRY[action];
}
