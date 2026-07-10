/**
 * Server-side identity → Principal resolution for MCP tools (§11.2).
 *
 * The MCP transport identity (a verified user id from the session/JWT) is mapped
 * to a Principal by reading the caller's roles and permissions FROM THE DATABASE.
 * Tools NEVER accept a client-supplied scope or role — only this resolved principal
 * is trusted. Resolution runs with the trusted connection.
 */
import type postgres from 'postgres';
import type { Permission, Principal } from '@hr/shared';

export async function resolvePrincipal(sql: postgres.Sql, userId: string): Promise<Principal | null> {
  const [user] = await sql<{ org_id: string }[]>`select org_id from app.users where id = ${userId}`;
  if (!user) return null;

  const permRows = await sql<{ resource: string; action: string; scope: string }[]>`
    select distinct perm.resource, perm.action, perm.scope
    from app.user_roles ur
    join app.role_permissions rp on rp.role_id = ur.role_id
    join app.permissions perm on perm.id = rp.permission_id
    where ur.user_id = ${userId}`;
  const permissions: Permission[] = permRows.map((p) => ({
    resource: p.resource as Permission['resource'],
    action: p.action as Permission['action'],
    scope: p.scope as Permission['scope'],
  }));

  const roleRows = await sql<{ key: string; scope: Record<string, unknown> }[]>`
    select r.key, ur.scope
    from app.user_roles ur join app.roles r on r.id = ur.role_id
    where ur.user_id = ${userId}`;
  const assigned = new Set<string>();
  for (const r of roleRows) {
    const list = (r.scope as { assigned_employee_ids?: string[] })?.assigned_employee_ids ?? [];
    for (const id of list) assigned.add(id);
  }

  return {
    userId,
    orgId: user.org_id,
    assignedEmployeeIds: [...assigned],
    permissions,
    roleKeys: roleRows.map((r) => r.key),
  };
}
