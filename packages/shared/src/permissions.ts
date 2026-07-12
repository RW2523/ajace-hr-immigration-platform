/**
 * Data-driven RBAC + ABAC permission model (BUILD_SPEC §3).
 *
 * Roles and permissions are DATA, not enums baked into code (§3.4): the four
 * launch roles are seed rows and new roles (Immigration Coordinator, Attorney,
 * Paralegal) are added by inserting rows — never by editing this file.
 *
 * This module defines the *shape* of permissions and the pure decision function.
 * The concrete role→permission grants live in the database (seeded from
 * `defaultRoleGrants` below) and are resolved per-request by the auth layer.
 *
 * All enforcement is server-side (§3.2). The client is never trusted to scope.
 */

/** Resource classes from the §3.3 access matrix. */
export const RESOURCES = [
  'own_profile',
  'others_profiles',
  'case_internals',
  'sensitive_pii', // SSN, passport, I-9 docs
  'work_authorization',
  'documents',
  'hr_items', // leave, reviews, training, benefits
  'helpdesk',
  'rules_engine',
  'templates',
  'role_provisioning',
  'audit_log',
  'system_config',
  'organizations',
] as const;
export type Resource = (typeof RESOURCES)[number];

/** Actions a permission can grant. */
export const ACTIONS = ['read', 'create', 'update', 'delete', 'manage'] as const;
export type Action = (typeof ACTIONS)[number];

/**
 * Scope qualifier (the ABAC "fine cut"). A grant is bounded by a scope that is
 * evaluated against the caller's attributes and the resource's attributes.
 *
 * - `own`     — only rows owned by the caller (owner_user_id === caller).
 * - `assigned`— rows for employees in the caller's assigned set (HR scoping).
 * - `org`     — any row within the caller's organization.
 * - `global`  — any row, any org (Admin).
 */
export const SCOPES = ['own', 'assigned', 'org', 'global'] as const;
export type Scope = (typeof SCOPES)[number];

/** Ranking so a broader scope satisfies a request needing a narrower one. */
const SCOPE_RANK: Record<Scope, number> = { own: 0, assigned: 1, org: 2, global: 3 };

export interface Permission {
  resource: Resource;
  action: Action;
  scope: Scope;
}

/** A permission key like `sensitive_pii:read:assigned` for compact storage/logging. */
export function permissionKey(p: Permission): string {
  return `${p.resource}:${p.action}:${p.scope}`;
}

export function parsePermissionKey(key: string): Permission {
  const [resource, action, scope] = key.split(':');
  return { resource: resource as Resource, action: action as Action, scope: scope as Scope };
}

/**
 * The authenticated caller's resolved identity + permission set.
 * Built server-side from the session; never from client input.
 */
export interface Principal {
  userId: string;
  orgId: string;
  /** Employee ids this principal is responsible for (HR "assigned" scope). */
  assignedEmployeeIds: string[];
  /** Flattened permission grants resolved from the caller's roles. */
  permissions: Permission[];
  /** Role keys, for logging/telemetry only — never for authorization decisions. */
  roleKeys: string[];
}

/** Attributes of the resource instance being accessed, for scope evaluation. */
export interface ResourceContext {
  /** user_id that owns the resource (for `own`). */
  ownerUserId?: string;
  /** employee_id the resource concerns (for `assigned`). */
  employeeId?: string;
  /** org the resource belongs to (for `org`). */
  orgId?: string;
}

export interface AccessRequest {
  resource: Resource;
  action: Action;
  /** The specific instance being accessed. Omit for collection-level checks. */
  context?: ResourceContext;
  /**
   * Instance-mutation guard. When true, a non-`global` scope will NOT be satisfied
   * unless the matching context attribute is present. This closes the write-path
   * IDOR class where a mutation calls requirePermission with no context and a
   * context-less scope check silently passes. Set it on every row mutation.
   */
  requireContext?: boolean;
}

export interface AccessDecision {
  allowed: boolean;
  /** The grant that permitted the request (for audit). */
  matchedPermission?: Permission;
  reason: string;
}

/**
 * Pure authorization decision. Deny by default (§3.2, §12).
 *
 * A request is allowed when the principal holds a permission whose resource and
 * action match (or `manage`, which implies all actions) AND whose scope both
 * (a) ranks high enough and (b) is satisfied by the resource context.
 */
export function decide(principal: Principal, req: AccessRequest): AccessDecision {
  const candidates = principal.permissions.filter(
    (p) => p.resource === req.resource && (p.action === req.action || p.action === 'manage'),
  );
  if (candidates.length === 0) {
    return { allowed: false, reason: `no grant for ${req.resource}:${req.action}` };
  }

  // Choose the narrowest scope that still satisfies the context, preferring the
  // most specific matched permission for a precise audit record.
  let best: Permission | undefined;
  for (const p of candidates) {
    if (scopeSatisfied(principal, p.scope, req.context, req.requireContext)) {
      if (!best || SCOPE_RANK[p.scope] < SCOPE_RANK[best.scope]) best = p;
    }
  }
  if (!best) {
    return {
      allowed: false,
      reason: `grant exists for ${req.resource}:${req.action} but no scope matched the resource`,
    };
  }
  return { allowed: true, matchedPermission: best, reason: 'granted' };
}

function scopeSatisfied(
  principal: Principal,
  scope: Scope,
  ctx?: ResourceContext,
  requireContext = false,
): boolean {
  switch (scope) {
    case 'global':
      return true;
    case 'org':
      // Collection-level (no ctx) org checks pass UNLESS the caller demands an
      // instance check (requireContext) — then a missing org is a denial.
      if (requireContext && !ctx?.orgId) return false;
      return !ctx?.orgId || ctx.orgId === principal.orgId;
    case 'assigned':
      if (!ctx) return !requireContext; // collection-level; row filtering applied downstream
      if (ctx.ownerUserId && ctx.ownerUserId === principal.userId) return true;
      return !!ctx.employeeId && principal.assignedEmployeeIds.includes(ctx.employeeId);
    case 'own':
      if (!ctx) return !requireContext;
      return !!ctx.ownerUserId && ctx.ownerUserId === principal.userId;
    default:
      return false;
  }
}

/**
 * True if the principal can act on rows beyond their own — i.e. holds
 * (resource, action) at `assigned`, `org`, or `global` scope. Use this for
 * staff-vs-employee UI and gating decisions instead of role-key inspection,
 * which the `primaryRole` contract explicitly forbids for authorization.
 */
export function hasStaffScope(principal: Principal, resource: Resource, action: Action): boolean {
  const s = effectiveScope(principal, resource, action);
  return s === 'assigned' || s === 'org' || s === 'global';
}

/** Thrown when a request is denied. Carries no sensitive detail. */
export class AuthorizationError extends Error {
  readonly code = 'FORBIDDEN';
  constructor(
    public readonly request: AccessRequest,
    public readonly detail: string,
  ) {
    super(`Forbidden: ${request.action} on ${request.resource}`);
    this.name = 'AuthorizationError';
  }
}

/**
 * Enforce a permission or throw. Every server action and MCP tool calls this.
 * Returns the matched permission so callers can log the exact grant used.
 */
export function requirePermission(principal: Principal, req: AccessRequest): Permission {
  const decision = decide(principal, req);
  if (!decision.allowed || !decision.matchedPermission) {
    throw new AuthorizationError(req, decision.reason);
  }
  return decision.matchedPermission;
}

/**
 * Resolve the effective row-filter scope for a collection query: the broadest
 * scope the principal holds for (resource, action). The DB layer translates
 * this into a WHERE clause (and RLS enforces it independently as defense-in-depth).
 */
export function effectiveScope(
  principal: Principal,
  resource: Resource,
  action: Action,
): Scope | null {
  const scopes = principal.permissions
    .filter((p) => p.resource === resource && (p.action === action || p.action === 'manage'))
    .map((p) => p.scope);
  if (scopes.length === 0) return null;
  return scopes.reduce((a, b) => (SCOPE_RANK[a] >= SCOPE_RANK[b] ? a : b));
}
