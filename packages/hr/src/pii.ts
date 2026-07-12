/**
 * Sensitive-PII services (§12): SSN and W-4. Every path:
 *   1. authorizes server-side via requirePermission (sensitive_pii)
 *   2. encrypts at the application layer (AES-GCM) before storage
 *   3. logs the access to the append-only audit_log (actor, resource, time)
 *
 * Reads return decrypted plaintext ONLY to an authorized caller and ALWAYS emit a
 * `sensitive_pii.read` audit event first. The ciphertext never leaves as plaintext
 * without passing this gate.
 */
import type postgres from 'postgres';
import {
  decryptPII,
  encryptPII,
  requirePermission,
  type AuditSink,
  type Principal,
} from '@hr/shared';

/** Resolve the org + owning user of an employee, for scope checks + audit. */
async function employeeContext(sql: postgres.Sql, employeeId: string) {
  const [row] = await sql<{ org_id: string; user_id: string | null }[]>`
    select org_id, user_id from app.employees where id = ${employeeId}`;
  return row ?? null;
}

export async function storeSSN(
  sql: postgres.Sql,
  audit: AuditSink,
  principal: Principal,
  employeeId: string,
  ssnPlaintext: string,
): Promise<void> {
  const ctx = await employeeContext(sql, employeeId);
  if (!ctx) throw new Error('employee not found');
  const grant = requirePermission(principal, {
    resource: 'sensitive_pii',
    action: 'create',
    context: { employeeId, ownerUserId: ctx.user_id ?? undefined, orgId: ctx.org_id },
  });
  const ciphertext = encryptPII(ssnPlaintext);
  await sql`
    insert into app.employee_ssn (employee_id, org_id, encrypted_ssn)
    values (${employeeId}, ${ctx.org_id}, ${ciphertext})
    on conflict (employee_id) do update set encrypted_ssn = excluded.encrypted_ssn, updated_at = now()`;
  await audit.record({
    actorUserId: principal.userId,
    orgId: ctx.org_id,
    action: 'sensitive_pii.create',
    resource: `employee_ssn:${employeeId}`,
    matchedPermission: `${grant.resource}:${grant.action}:${grant.scope}`,
  });
}

export async function readSSN(
  sql: postgres.Sql,
  audit: AuditSink,
  principal: Principal,
  employeeId: string,
): Promise<string | null> {
  const ctx = await employeeContext(sql, employeeId);
  if (!ctx) return null;
  const grant = requirePermission(principal, {
    resource: 'sensitive_pii',
    action: 'read',
    context: { employeeId, ownerUserId: ctx.user_id ?? undefined, orgId: ctx.org_id },
  });
  // Log BEFORE returning the value (§12: all access to sensitive PII is logged).
  await audit.record({
    actorUserId: principal.userId,
    orgId: ctx.org_id,
    action: 'sensitive_pii.read',
    resource: `employee_ssn:${employeeId}`,
    matchedPermission: `${grant.resource}:${grant.action}:${grant.scope}`,
  });
  const [row] = await sql<{ encrypted_ssn: string }[]>`
    select encrypted_ssn from app.employee_ssn where employee_id = ${employeeId}`;
  return row ? decryptPII(row.encrypted_ssn) : null;
}

export async function storeW4(
  sql: postgres.Sql,
  audit: AuditSink,
  principal: Principal,
  employeeId: string,
  w4Data: Record<string, unknown>,
  taxYear: number,
): Promise<void> {
  const ctx = await employeeContext(sql, employeeId);
  if (!ctx) throw new Error('employee not found');
  const grant = requirePermission(principal, {
    resource: 'sensitive_pii',
    action: 'create',
    context: { employeeId, ownerUserId: ctx.user_id ?? undefined, orgId: ctx.org_id },
  });
  const ciphertext = encryptPII(JSON.stringify(w4Data));
  await sql`
    insert into app.w4_records (org_id, employee_id, encrypted_payload, tax_year)
    values (${ctx.org_id}, ${employeeId}, ${ciphertext}, ${taxYear})`;
  await audit.record({
    actorUserId: principal.userId,
    orgId: ctx.org_id,
    action: 'sensitive_pii.create',
    resource: `w4_records:${employeeId}`,
    matchedPermission: `${grant.resource}:${grant.action}:${grant.scope}`,
  });
}

/** Sensitive immigration identifiers kept out of the plaintext profile (§12). */
export interface SecureIds {
  passport_number?: string;
  passport_country?: string;
  passport_issue?: string;
  passport_expiry?: string;
  sevis_number?: string;
  alien_registration_number?: string;
}

export async function storeSecureIds(
  sql: postgres.Sql,
  audit: AuditSink,
  principal: Principal,
  employeeId: string,
  ids: SecureIds,
): Promise<void> {
  const ctx = await employeeContext(sql, employeeId);
  if (!ctx) throw new Error('employee not found');
  const grant = requirePermission(principal, {
    resource: 'sensitive_pii', action: 'create', requireContext: true,
    context: { employeeId, ownerUserId: ctx.user_id ?? undefined, orgId: ctx.org_id },
  });
  const ciphertext = encryptPII(JSON.stringify(ids));
  await sql`
    insert into app.employee_secure_ids (employee_id, org_id, encrypted_payload)
    values (${employeeId}, ${ctx.org_id}, ${ciphertext})
    on conflict (employee_id) do update set encrypted_payload = excluded.encrypted_payload, updated_at = now()`;
  await audit.record({
    actorUserId: principal.userId,
    orgId: ctx.org_id,
    action: 'sensitive_pii.create',
    resource: `employee_secure_ids:${employeeId}`,
    matchedPermission: `${grant.resource}:${grant.action}:${grant.scope}`,
  });
}

export async function readSecureIds(
  sql: postgres.Sql,
  audit: AuditSink,
  principal: Principal,
  employeeId: string,
): Promise<SecureIds | null> {
  const ctx = await employeeContext(sql, employeeId);
  if (!ctx) return null;
  const grant = requirePermission(principal, {
    resource: 'sensitive_pii', action: 'read', requireContext: true,
    context: { employeeId, ownerUserId: ctx.user_id ?? undefined, orgId: ctx.org_id },
  });
  await audit.record({
    actorUserId: principal.userId,
    orgId: ctx.org_id,
    action: 'sensitive_pii.read',
    resource: `employee_secure_ids:${employeeId}`,
    matchedPermission: `${grant.resource}:${grant.action}:${grant.scope}`,
  });
  const [row] = await sql<{ encrypted_payload: string }[]>`
    select encrypted_payload from app.employee_secure_ids where employee_id = ${employeeId}`;
  return row ? (JSON.parse(decryptPII(row.encrypted_payload)) as SecureIds) : null;
}

export async function readW4(
  sql: postgres.Sql,
  audit: AuditSink,
  principal: Principal,
  employeeId: string,
  taxYear: number,
): Promise<Record<string, unknown> | null> {
  const ctx = await employeeContext(sql, employeeId);
  if (!ctx) return null;
  const grant = requirePermission(principal, {
    resource: 'sensitive_pii',
    action: 'read',
    context: { employeeId, ownerUserId: ctx.user_id ?? undefined, orgId: ctx.org_id },
  });
  await audit.record({
    actorUserId: principal.userId,
    orgId: ctx.org_id,
    action: 'sensitive_pii.read',
    resource: `w4_records:${employeeId}`,
    matchedPermission: `${grant.resource}:${grant.action}:${grant.scope}`,
  });
  const [row] = await sql<{ encrypted_payload: string }[]>`
    select encrypted_payload from app.w4_records
    where employee_id = ${employeeId} and tax_year = ${taxYear}
    order by created_at desc limit 1`;
  return row ? (JSON.parse(decryptPII(row.encrypted_payload)) as Record<string, unknown>) : null;
}
