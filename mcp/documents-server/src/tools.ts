/**
 * documents-server tool logic (§11.1). Access-controlled document operations.
 * Sensitive documents (I-9, passport) require the `sensitive_pii` grant; all others
 * the `documents` grant. Downloads are issued as signed, time-limited URLs only —
 * never a permanent link — and every sensitive download is audited (§12).
 */
import type postgres from 'postgres';
import { z } from 'zod';
import { requirePermission, type AuditSink, type Principal } from '@hr/shared';
import { loadRuleData, requiredDocumentsForStatus } from '@hr/rules-engine';
import { signStorageUrl } from './signed-url.js';

async function caseContext(sql: postgres.Sql, caseId: string) {
  const [c] = await sql<{ org_id: string; employee_id: string; current_status: string; user_id: string | null }[]>`
    select c.org_id, c.employee_id, c.current_status, e.user_id
    from app.immigration_cases c join app.employees e on e.id = c.employee_id
    where c.id = ${caseId}`;
  return c ?? null;
}

// ── docs_list_for_case ──────────────────────────────────────────────────────
export const docsListInput = z.object({ case_id: z.string().uuid() });
export async function docsListForCase(sql: postgres.Sql, principal: Principal, input: { case_id: string }) {
  const c = await caseContext(sql, input.case_id);
  if (!c) return { found: false as const, documents: [] };
  requirePermission(principal, {
    resource: 'documents',
    action: 'read',
    context: { employeeId: c.employee_id, ownerUserId: c.user_id ?? undefined, orgId: c.org_id },
  });
  const rows = await sql<{ id: string; document_type: string; version: number; sensitive_pii: boolean; filename: string | null }[]>`
    select id, document_type, version, sensitive_pii, filename from app.documents where case_id = ${input.case_id}`;
  // Filter sensitive docs unless the caller also holds sensitive_pii read.
  const canSensitive = tryPermit(principal, 'sensitive_pii', c);
  return {
    found: true as const,
    documents: rows
      .filter((r) => !r.sensitive_pii || canSensitive)
      .map((r) => ({ id: r.id, document_type: r.document_type, version: r.version, sensitive: r.sensitive_pii, filename: r.filename })),
  };
}

// ── docs_get_signed_url (time-limited; audits sensitive downloads) ──────────
export const docsSignedUrlInput = z.object({ document_id: z.string().uuid(), ttl_seconds: z.number().int().min(30).max(3600).optional() });
export async function docsGetSignedUrl(
  sql: postgres.Sql,
  audit: AuditSink,
  principal: Principal,
  nowMs: number,
  input: { document_id: string; ttl_seconds?: number },
) {
  const [d] = await sql<{ org_id: string; employee_id: string | null; storage_key: string; sensitive_pii: boolean; user_id: string | null }[]>`
    select d.org_id, d.employee_id, d.storage_key, d.sensitive_pii, e.user_id
    from app.documents d left join app.employees e on e.id = d.employee_id
    where d.id = ${input.document_id}`;
  if (!d) return { found: false as const };
  requirePermission(principal, {
    resource: d.sensitive_pii ? 'sensitive_pii' : 'documents',
    action: 'read',
    context: { employeeId: d.employee_id ?? undefined, ownerUserId: d.user_id ?? undefined, orgId: d.org_id },
  });
  if (d.sensitive_pii) {
    await audit.record({
      actorUserId: principal.userId,
      orgId: d.org_id,
      action: 'document.download',
      resource: `documents:${input.document_id}`,
    });
  }
  const signed = signStorageUrl(d.storage_key, nowMs, input.ttl_seconds);
  return { found: true as const, ...signed };
}

// ── docs_request_upload ─────────────────────────────────────────────────────
export const docsRequestUploadInput = z.object({
  case_id: z.string().uuid(),
  document_type: z.string(),
});
export async function docsRequestUpload(sql: postgres.Sql, principal: Principal, input: z.infer<typeof docsRequestUploadInput>) {
  const c = await caseContext(sql, input.case_id);
  if (!c) return { ok: false as const, error: 'case not found' };
  requirePermission(principal, {
    resource: 'documents',
    action: 'create',
    context: { employeeId: c.employee_id, ownerUserId: c.user_id ?? undefined, orgId: c.org_id },
  });
  const [req] = await sql<{ key: string; sensitive_pii: boolean; uploader: string }[]>`
    select key, sensitive_pii, uploader from app.document_requirements where key = ${input.document_type}`;
  // A pre-signed upload target would be minted here; we return the intended slot.
  return {
    ok: true as const,
    case_id: input.case_id,
    document_type: input.document_type,
    sensitive: req?.sensitive_pii ?? false,
    expected_uploader: req?.uploader ?? 'employee',
    upload_key: `orgs/${c.org_id}/cases/${input.case_id}/${input.document_type}`,
  };
}

// ── docs_check_requirements ─────────────────────────────────────────────────
export const docsCheckReqInput = z.object({ case_id: z.string().uuid() });
export async function docsCheckRequirements(sql: postgres.Sql, principal: Principal, input: { case_id: string }) {
  const c = await caseContext(sql, input.case_id);
  if (!c) return { found: false as const, required: [], missing: [] };
  requirePermission(principal, {
    resource: 'documents',
    action: 'read',
    context: { employeeId: c.employee_id, ownerUserId: c.user_id ?? undefined, orgId: c.org_id },
  });
  const data = await loadRuleData(sql);
  const required = requiredDocumentsForStatus(data, c.current_status);
  const have = (await sql<{ document_type: string }[]>`select document_type from app.documents where case_id = ${input.case_id}`).map((r) => r.document_type);
  return { found: true as const, required, missing: required.filter((r) => !have.includes(r)) };
}

/** Non-throwing permission probe (for optional sensitive filtering). */
function tryPermit(principal: Principal, resource: 'sensitive_pii', c: { employee_id: string; user_id: string | null; org_id: string }): boolean {
  try {
    requirePermission(principal, {
      resource,
      action: 'read',
      context: { employeeId: c.employee_id, ownerUserId: c.user_id ?? undefined, orgId: c.org_id },
    });
    return true;
  } catch {
    return false;
  }
}
