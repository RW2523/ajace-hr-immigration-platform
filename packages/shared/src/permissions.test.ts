import { describe, expect, it } from 'vitest';
import {
  decide,
  effectiveScope,
  hasStaffScope,
  requirePermission,
  AuthorizationError,
  type Principal,
} from './permissions.js';
import { DEFAULT_ROLES, roleByKey } from './roles.js';

function principalFor(roleKey: string, over: Partial<Principal> = {}): Principal {
  const role = roleByKey(roleKey)!;
  return {
    userId: over.userId ?? 'user-self',
    orgId: over.orgId ?? 'org-1',
    assignedEmployeeIds: over.assignedEmployeeIds ?? [],
    permissions: role.permissions,
    roleKeys: [roleKey],
    ...over,
  };
}

describe('access matrix (§3.3)', () => {
  it('employee can read their own profile but not others', () => {
    const p = principalFor('employee', { userId: 'u1' });
    expect(decide(p, { resource: 'own_profile', action: 'read', context: { ownerUserId: 'u1' } }).allowed).toBe(true);
    expect(decide(p, { resource: 'others_profiles', action: 'read', context: { ownerUserId: 'u2' } }).allowed).toBe(false);
  });

  it('employee cannot read another user\'s case internals', () => {
    const p = principalFor('employee', { userId: 'u1' });
    expect(decide(p, { resource: 'case_internals', action: 'read', context: { ownerUserId: 'u1' } }).allowed).toBe(true);
    expect(decide(p, { resource: 'case_internals', action: 'read', context: { ownerUserId: 'u2' } }).allowed).toBe(false);
  });

  it('employee has no access to the rules engine, audit log, or provisioning', () => {
    const p = principalFor('employee');
    for (const resource of ['rules_engine', 'audit_log', 'role_provisioning', 'system_config'] as const) {
      expect(decide(p, { resource, action: 'read' }).allowed).toBe(false);
    }
  });

  it('HR can read sensitive PII only for assigned employees (need-to-know)', () => {
    const p = principalFor('hr', { userId: 'hr1', assignedEmployeeIds: ['emp-A'] });
    expect(decide(p, { resource: 'sensitive_pii', action: 'read', context: { employeeId: 'emp-A' } }).allowed).toBe(true);
    expect(decide(p, { resource: 'sensitive_pii', action: 'read', context: { employeeId: 'emp-B' } }).allowed).toBe(false);
  });

  it('HR cannot touch the rules engine or provisioning', () => {
    const p = principalFor('hr');
    expect(decide(p, { resource: 'rules_engine', action: 'update' }).allowed).toBe(false);
    expect(decide(p, { resource: 'role_provisioning', action: 'manage' }).allowed).toBe(false);
  });

  it('Employer has org-wide operational access but not system config', () => {
    const p = principalFor('employer', { userId: 'boss', orgId: 'org-1' });
    expect(decide(p, { resource: 'others_profiles', action: 'read', context: { orgId: 'org-1' } }).allowed).toBe(true);
    expect(decide(p, { resource: 'sensitive_pii', action: 'read', context: { orgId: 'org-1' } }).allowed).toBe(true);
    // Not another org
    expect(decide(p, { resource: 'others_profiles', action: 'read', context: { orgId: 'org-2' } }).allowed).toBe(false);
    // Not system config / rules
    expect(decide(p, { resource: 'system_config', action: 'manage' }).allowed).toBe(false);
    expect(decide(p, { resource: 'rules_engine', action: 'update' }).allowed).toBe(false);
  });

  it('Admin can manage everything, across orgs', () => {
    const p = principalFor('admin', { orgId: 'org-1' });
    for (const resource of ['rules_engine', 'audit_log', 'system_config', 'role_provisioning'] as const) {
      expect(decide(p, { resource, action: 'manage' }).allowed).toBe(true);
    }
    // cross-org
    expect(decide(p, { resource: 'sensitive_pii', action: 'read', context: { orgId: 'org-99' } }).allowed).toBe(true);
  });
});

describe('deny by default', () => {
  it('a principal with no permissions is denied everything', () => {
    const p: Principal = { userId: 'x', orgId: 'o', assignedEmployeeIds: [], permissions: [], roleKeys: [] };
    expect(decide(p, { resource: 'own_profile', action: 'read' }).allowed).toBe(false);
  });

  it('requirePermission throws AuthorizationError on denial', () => {
    const p = principalFor('employee', { userId: 'u1' });
    expect(() =>
      requirePermission(p, { resource: 'sensitive_pii', action: 'read', context: { ownerUserId: 'u2' } }),
    ).toThrow(AuthorizationError);
  });

  it('requirePermission returns the matched grant on success', () => {
    const p = principalFor('employee', { userId: 'u1' });
    const grant = requirePermission(p, { resource: 'own_profile', action: 'read', context: { ownerUserId: 'u1' } });
    expect(grant.scope).toBe('own');
  });
});

describe('effectiveScope (row-filter resolution)', () => {
  it('resolves the broadest scope for collection queries', () => {
    expect(effectiveScope(principalFor('employee'), 'documents', 'read')).toBe('own');
    expect(effectiveScope(principalFor('hr'), 'documents', 'read')).toBe('assigned');
    expect(effectiveScope(principalFor('employer'), 'documents', 'read')).toBe('org');
    expect(effectiveScope(principalFor('admin'), 'documents', 'read')).toBe('global');
  });

  it('returns null when the principal holds no grant', () => {
    expect(effectiveScope(principalFor('employee'), 'audit_log', 'read')).toBeNull();
  });
});

describe('write-path IDOR guard (requireContext)', () => {
  // Regression for the confirmed IDOR: a mutation that called requirePermission
  // with NO context used to pass for any non-global scope. requireContext closes it.
  it('an org-scoped mutation with NO context is DENIED when requireContext is set', () => {
    const employer = principalFor('employer', { orgId: 'org-1' });
    // Without requireContext, the legacy behavior granted (this is the bug):
    expect(decide(employer, { resource: 'hr_items', action: 'update' }).allowed).toBe(true);
    // With requireContext, a context-less instance mutation is denied:
    expect(decide(employer, { resource: 'hr_items', action: 'update', requireContext: true }).allowed).toBe(false);
  });

  it('an assigned-scope (HR) mutation requires the row to be in the assigned set', () => {
    const hr = principalFor('hr', { userId: 'hr1', assignedEmployeeIds: ['emp-A'] });
    // Cross-employee row → denied even with the grant.
    expect(decide(hr, { resource: 'hr_items', action: 'update', requireContext: true, context: { employeeId: 'emp-B', orgId: 'org-1' } }).allowed).toBe(false);
    // Own assigned employee → allowed.
    expect(decide(hr, { resource: 'hr_items', action: 'update', requireContext: true, context: { employeeId: 'emp-A', orgId: 'org-1' } }).allowed).toBe(true);
  });

  it('an org-scoped mutation is denied for a row in a DIFFERENT org', () => {
    const employer = principalFor('employer', { orgId: 'org-1' });
    expect(decide(employer, { resource: 'hr_items', action: 'update', requireContext: true, context: { orgId: 'org-2' } }).allowed).toBe(false);
    expect(decide(employer, { resource: 'hr_items', action: 'update', requireContext: true, context: { orgId: 'org-1' } }).allowed).toBe(true);
  });

  it('collection reads (no requireContext) still pass for staff row-filtering', () => {
    const hr = principalFor('hr', { assignedEmployeeIds: ['emp-A'] });
    expect(decide(hr, { resource: 'hr_items', action: 'read' }).allowed).toBe(true);
  });
});

describe('hasStaffScope (replaces role-key authz)', () => {
  it('is false for an employee and true for HR/employer/admin', () => {
    expect(hasStaffScope(principalFor('employee'), 'hr_items', 'update')).toBe(false);
    expect(hasStaffScope(principalFor('hr'), 'hr_items', 'update')).toBe(true);
    expect(hasStaffScope(principalFor('employer'), 'helpdesk', 'update')).toBe(true);
    expect(hasStaffScope(principalFor('admin'), 'helpdesk', 'update')).toBe(true);
  });
});

describe('role definitions are well-formed', () => {
  it('every default role has at least one permission and a unique key', () => {
    const keys = new Set(DEFAULT_ROLES.map((r) => r.key));
    expect(keys.size).toBe(DEFAULT_ROLES.length);
    for (const r of DEFAULT_ROLES) expect(r.permissions.length).toBeGreaterThan(0);
  });
});
