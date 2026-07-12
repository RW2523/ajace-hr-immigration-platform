/**
 * Default role → permission grants, implementing the §3.3 access matrix.
 *
 * These are SEED VALUES loaded into the `roles` / `permissions` / `role_permissions`
 * tables. They are data, not law: the firm can add roles (Immigration Coordinator,
 * Attorney, Paralegal — §3.4) by inserting rows without touching code.
 *
 * Access matrix (§3.3):
 *   Data                          | Employee | HR         | Employer | Admin
 *   Own profile & HR items        | own      | assigned   | org      | global
 *   Others' profiles              | —        | assigned   | org      | global
 *   Case internals                | own      | assigned   | org      | global
 *   Sensitive PII                 | own      | assigned†  | org      | global (logged)
 *   Work-authorization validity   | own      | assigned   | org      | global
 *   Rules / templates / roles /   | —        | —          | —        | global
 *     audit / system config
 *   († HR sensitive PII is "need-to-know" — modeled as `assigned` scope + audit.)
 */
import type { Action, Permission, Resource, Scope } from './permissions.js';

export interface RoleDefinition {
  key: string;
  label: string;
  description: string;
  /** Lower = higher privilege (Admin=0). For display/ordering only. */
  rank: number;
  permissions: Permission[];
}

function grant(resource: Resource, actions: Action[], scope: Scope): Permission[] {
  return actions.map((action) => ({ resource, action, scope }));
}

const EMPLOYEE: RoleDefinition = {
  key: 'employee',
  label: 'Employee',
  description: 'Own data only: profile, immigration status/deadlines/documents, HR items, own-scope help desk.',
  rank: 3,
  permissions: [
    ...grant('own_profile', ['read', 'update'], 'own'),
    ...grant('case_internals', ['read'], 'own'),
    ...grant('work_authorization', ['read'], 'own'),
    ...grant('sensitive_pii', ['read', 'create', 'update'], 'own'),
    ...grant('documents', ['read', 'create'], 'own'),
    ...grant('hr_items', ['read', 'create'], 'own'),
    ...grant('helpdesk', ['read', 'create'], 'own'),
  ],
};

const HR: RoleDefinition = {
  key: 'hr',
  label: 'HR',
  description: 'Scoped operational role: HR lifecycle + immigration coordination for assigned employees; need-to-know PII.',
  rank: 2,
  permissions: [
    ...grant('own_profile', ['read', 'update'], 'own'),
    ...grant('others_profiles', ['read', 'create', 'update'], 'assigned'),
    ...grant('case_internals', ['read', 'update'], 'assigned'),
    ...grant('work_authorization', ['read'], 'assigned'),
    ...grant('sensitive_pii', ['read'], 'assigned'), // need-to-know; audited
    ...grant('documents', ['read', 'create', 'update'], 'assigned'),
    ...grant('hr_items', ['read', 'create', 'update'], 'assigned'),
    ...grant('helpdesk', ['read', 'create', 'update'], 'assigned'),
  ],
};

const EMPLOYER: RoleDefinition = {
  key: 'employer',
  label: 'Employer',
  description: "Firm leadership: full operational access to the org's data. Below Admin (no system config / provisioning / rules editing).",
  rank: 1,
  permissions: [
    ...grant('own_profile', ['read', 'update'], 'own'),
    ...grant('others_profiles', ['read', 'create', 'update', 'delete'], 'org'),
    ...grant('case_internals', ['read', 'create', 'update'], 'org'),
    ...grant('work_authorization', ['read'], 'org'),
    ...grant('sensitive_pii', ['read', 'create', 'update'], 'org'),
    ...grant('documents', ['read', 'create', 'update', 'delete'], 'org'),
    ...grant('hr_items', ['read', 'create', 'update', 'delete'], 'org'),
    ...grant('helpdesk', ['read', 'create', 'update'], 'org'),
    ...grant('templates', ['read'], 'org'),
  ],
};

const COUNSEL: RoleDefinition = {
  key: 'counsel',
  label: 'Counsel',
  description:
    'Immigration attorney / counsel of record. Receives the escalated (tier 3) deadline reminders; read access to case internals and work authorization for the org.',
  // Ranked alongside HR (2): an operational, read-scoped reviewer — not firm leadership.
  rank: 2,
  permissions: [
    ...grant('own_profile', ['read', 'update'], 'own'),
    ...grant('others_profiles', ['read'], 'org'),
    ...grant('case_internals', ['read'], 'org'),
    ...grant('work_authorization', ['read'], 'org'),
    ...grant('sensitive_pii', ['read'], 'org'), // need-to-know for filings; audited
    ...grant('documents', ['read'], 'org'),
  ],
};

const ADMIN: RoleDefinition = {
  key: 'admin',
  label: 'Admin',
  description: 'Platform superuser: provisioning, roles, system config, rules table, templates, audit log. Full access, always logged.',
  rank: 0,
  permissions: [
    // Admin gets `manage` at global scope on every resource class.
    ...(
      [
        'own_profile', 'others_profiles', 'case_internals', 'sensitive_pii',
        'work_authorization', 'documents', 'hr_items', 'helpdesk',
        'rules_engine', 'templates', 'role_provisioning', 'audit_log',
        'system_config', 'organizations',
      ] as Resource[]
    ).map((resource) => ({ resource, action: 'manage' as Action, scope: 'global' as Scope })),
  ],
};

export const DEFAULT_ROLES: RoleDefinition[] = [ADMIN, EMPLOYER, COUNSEL, HR, EMPLOYEE];

export function roleByKey(key: string): RoleDefinition | undefined {
  return DEFAULT_ROLES.find((r) => r.key === key);
}
