/**
 * Server-side session → Principal resolution (§3.2).
 *
 * In production the user id comes from the Supabase session cookie, verified
 * server-side. For local development (no Supabase project) a signed dev-session
 * cookie (`hr_uid`) holds an already-provisioned user id. Either way the id is
 * resolved to a Principal by reading roles/permissions FROM THE DATABASE — the
 * client never supplies a scope or role.
 */
import 'server-only';
import { cache } from 'react';
import type postgres from 'postgres';
import type { Permission, Principal } from '@hr/shared';
import { createSql } from '@hr/db';
import { supabaseServer } from './supabase/server';

let _sql: postgres.Sql | null = null;
export function db(): postgres.Sql {
  // Serverless-/pooler-safe (see @hr/db createSql): small pool + no prepared
  // statements when talking to Supabase's transaction pooler. Requires
  // DATABASE_URL in production.
  if (!_sql) _sql = createSql();
  return _sql;
}

/**
 * The verified user id from the Supabase session. This is the authoritative
 * identity — never a client-supplied value. It equals app.users.id and auth.uid().
 */
export async function currentUserId(): Promise<string | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user.id;
}

export async function signOut(): Promise<void> {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
}

// Wrapped in React cache() so repeated getPrincipal() calls within a single request
// (layout + page + server actions) resolve once instead of re-running the auth +
// permission queries each time. The stable Principal it returns also lets the
// scoped-data helpers (cache()d on `principal`) dedupe.
export const getPrincipal = cache(async (): Promise<Principal | null> => {
  const userId = await currentUserId();
  if (!userId) return null;
  const sql = db();
  const [user] = await sql<{ org_id: string }[]>`select org_id from app.users where id = ${userId}`;
  if (!user) return null;

  // The permission and role reads are independent — run them concurrently (the
  // pooler allows >1 connection; see @hr/db createSql).
  const [permRows, roleRows] = await Promise.all([
    sql<{ resource: string; action: string; scope: string }[]>`
      select distinct perm.resource, perm.action, perm.scope
      from app.user_roles ur
      join app.role_permissions rp on rp.role_id = ur.role_id
      join app.permissions perm on perm.id = rp.permission_id
      where ur.user_id = ${userId}`,
    sql<{ key: string; scope: Record<string, unknown> }[]>`
      select r.key, ur.scope from app.user_roles ur join app.roles r on r.id = ur.role_id where ur.user_id = ${userId}`,
  ]);
  const permissions = permRows as unknown as Permission[];
  const assigned = new Set<string>();
  for (const r of roleRows) for (const id of ((r.scope as { assigned_employee_ids?: string[] })?.assigned_employee_ids ?? [])) assigned.add(id);

  return {
    userId,
    orgId: user.org_id,
    assignedEmployeeIds: [...assigned],
    permissions,
    roleKeys: roleRows.map((r) => r.key),
  };
});

/** Highest-privilege role key for UI routing (display only; never for authz). */
export function primaryRole(principal: Principal): string {
  const order = ['admin', 'employer', 'hr', 'employee'];
  return order.find((r) => principal.roleKeys.includes(r)) ?? principal.roleKeys[0] ?? 'employee';
}
