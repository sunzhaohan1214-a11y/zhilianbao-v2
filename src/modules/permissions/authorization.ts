import type { Capability } from "./capability-registry";
import { getActionDefinition } from "./capability-registry";
import { PermissionError } from "./permission-errors";
import { requireResourceScope } from "./scope-resolver";
import type {
  AuthorizationPolicy,
  AuthorizationResult,
  PermissionActor,
  ResourceScopeInput,
} from "./types";

export type AuthorizeActorInput = {
  actor: PermissionActor;
  action: Capability;
  resource?: Omit<ResourceScopeInput, "requiredScope"> & { requiredScope?: ResourceScopeInput["requiredScope"] };
  relationPolicy?: AuthorizationPolicy;
  statePolicy?: AuthorizationPolicy;
};

async function evaluatePolicy(policy: AuthorizationPolicy, actor: PermissionActor): Promise<boolean> {
  return typeof policy === "function" ? policy(actor) : policy;
}
export async function authorizeActor(input: AuthorizeActorInput): Promise<AuthorizationResult> {
  const definition = getActionDefinition(input.action);
  if (!input.actor.capabilities.has(input.action)) {
    throw new PermissionError("FORBIDDEN_CAPABILITY", "当前角色不允许执行此操作", { action: input.action });
  }

  if (input.resource) {
    const requiredScope = input.resource.requiredScope ?? definition.defaultScope;
    if (requiredScope) requireResourceScope(input.actor, { ...input.resource, requiredScope });
  }

  if (input.relationPolicy !== undefined && !await evaluatePolicy(input.relationPolicy, input.actor)) {
    throw new PermissionError("FORBIDDEN_RELATION", "当前账号与该业务资源的关系不允许此操作", {
      action: input.action,
    });
  }

  if (input.statePolicy !== undefined && !await evaluatePolicy(input.statePolicy, input.actor)) {
    throw new PermissionError("FORBIDDEN_STATE", "当前业务状态不允许此操作", { action: input.action });
  }

  if (definition.neverAllow) {
    throw new PermissionError("FORBIDDEN_SENSITIVE_PERMISSION", "该隐私数据不允许读取", {
      action: input.action,
    });
  }
  if (definition.superAdminOnly && !input.actor.hasSystem) {
    throw new PermissionError("FORBIDDEN_SENSITIVE_PERMISSION", "此高风险操作仅限超级管理员", {
      action: input.action,
    });
  }
  if (
    definition.sensitivePermission
    && !input.actor.specialPermissions.has(definition.sensitivePermission)
  ) {
    throw new PermissionError("FORBIDDEN_SENSITIVE_PERMISSION", "缺少所需的敏感权限", {
      action: input.action,
      sensitivePermission: definition.sensitivePermission,
    });
  }
  return { allowed: true, actor: input.actor };
}
