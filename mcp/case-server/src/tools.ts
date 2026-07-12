/**
 * case-server tool logic (§11.1). Each tool authorizes against the caller's
 * resolved Principal (server-side) and returns ONLY permitted data. Tool logic is
 * separated from transport so it is directly unit/eval-testable, including
 * authorization-denial cases.
 */
import type postgres from 'postgres';
import { z } from 'zod';
import { requirePermission, type Principal } from '@hr/shared';
import { loadRuleData, validateCase, requiredDocumentsForStatus, type CaseSnapshot } from '@hr/rules-engine';

/** Load a case and enforce the caller may read its internals; returns null if not found. */
async function authorizeCaseRead(sql: postgres.Sql, principal: Principal, caseId: string) {
  const [c] = await sql<{ org_id: string; employee_id: string; current_status: string; user_id: string | null }[]>`
    select c.org_id, c.employee_id, c.current_status, e.user_id
    from app.immigration_cases c join app.employees e on e.id = c.employee_id
    where c.id = ${caseId}`;
  if (!c) return null;
  requirePermission(principal, {
    resource: 'case_internals',
    action: 'read',
    context: { employeeId: c.employee_id, ownerUserId: c.user_id ?? undefined, orgId: c.org_id },
  });
  return c;
}

async function snapshot(sql: postgres.Sql, caseId: string, currentStatus: string): Promise<CaseSnapshot> {
  const dateRows = await sql<{ date_type: string; value: string }[]>`
    select date_type, to_char(value,'YYYY-MM-DD') as value from app.case_dates where case_id = ${caseId}`;
  const docRows = await sql<{ document_type: string }[]>`
    select document_type from app.documents where case_id = ${caseId}`;
  const dates: Record<string, string> = {};
  for (const r of dateRows) dates[r.date_type] = r.value;
  return { currentStatus, dates, collectedDocuments: docRows.map((d) => d.document_type), attributes: {} };
}

// ── case_get_status ─────────────────────────────────────────────────────────
export const caseGetStatusInput = z.object({ case_id: z.string().uuid() });
export async function caseGetStatus(sql: postgres.Sql, principal: Principal, input: { case_id: string }) {
  const c = await authorizeCaseRead(sql, principal, input.case_id);
  if (!c) return { found: false as const };
  return { found: true as const, case_id: input.case_id, current_status: c.current_status, employee_id: c.employee_id };
}

// ── case_list_deadlines ─────────────────────────────────────────────────────
export const caseListDeadlinesInput = z.object({ case_id: z.string().uuid() });
export async function caseListDeadlines(sql: postgres.Sql, principal: Principal, input: { case_id: string }) {
  const c = await authorizeCaseRead(sql, principal, input.case_id);
  if (!c) return { found: false as const, deadlines: [] };
  const rows = await sql<{ date_type: string; value: string }[]>`
    select date_type, to_char(value,'YYYY-MM-DD') as value from app.case_dates
    where case_id = ${input.case_id} order by value asc`;
  return { found: true as const, deadlines: rows.map((r) => ({ date_type: r.date_type, date: r.value })) };
}

// ── case_check_transition_eligibility (composes rules + dates + docs) ────────
export const caseCheckEligibilityInput = z.object({ case_id: z.string().uuid(), as_of: z.string().optional() });
export async function caseCheckEligibility(
  sql: postgres.Sql,
  principal: Principal,
  input: { case_id: string; as_of?: string },
) {
  const c = await authorizeCaseRead(sql, principal, input.case_id);
  if (!c) return { found: false as const };
  const asOf = input.as_of ?? new Date().toISOString().slice(0, 10);
  const data = await loadRuleData(sql);
  const snap = await snapshot(sql, input.case_id, c.current_status);
  const result = validateCase(data, snap, asOf);
  return {
    found: true as const,
    current_status: result.currentStatus,
    as_of: asOf,
    counsel_pending: result.anyCounselPending,
    eligible_transitions: result.eligibleTransitions.map((t) => ({ to: t.toStatus, key: t.transitionKey })),
    // Blocked only by preconditions the engine cannot confirm — render as "pending
    // counsel review", never as a green "eligible" (Bug 1).
    needs_counsel_review_transitions: result.needsCounselReviewTransitions.map((t) => ({
      to: t.toStatus,
      key: t.transitionKey,
      unconfirmed_preconditions: t.unconfirmedPreconditions,
    })),
    ineligible_transitions: result.ineligibleTransitions.map((t) => ({
      to: t.toStatus,
      missing_documents: t.missingDocuments,
      unmet_preconditions: t.unmetPreconditions,
      unconfirmed_preconditions: t.unconfirmedPreconditions,
    })),
    findings: result.findings.map((f) => ({ code: f.code, severity: f.severity, message: f.message, counsel_pending: f.counselPending })),
  };
}

// ── case_list_required_documents ────────────────────────────────────────────
export const caseListRequiredDocsInput = z.object({ case_id: z.string().uuid() });
export async function caseListRequiredDocs(sql: postgres.Sql, principal: Principal, input: { case_id: string }) {
  const c = await authorizeCaseRead(sql, principal, input.case_id);
  if (!c) return { found: false as const, required_documents: [], missing_documents: [] };
  const data = await loadRuleData(sql);
  const required = requiredDocumentsForStatus(data, c.current_status);
  const have = (
    await sql<{ document_type: string }[]>`select document_type from app.documents where case_id = ${input.case_id}`
  ).map((r) => r.document_type);
  return {
    found: true as const,
    required_documents: required,
    missing_documents: required.filter((d) => !have.includes(d)),
  };
}

// ── case_record_transition (WRITE; destructive hint) ────────────────────────
export const caseRecordTransitionInput = z.object({
  case_id: z.string().uuid(),
  to_status: z.string(),
  transition_key: z.string().optional(),
  filed_on: z.string().optional(),
  receipt_number: z.string().optional(),
});
export async function caseRecordTransition(
  sql: postgres.Sql,
  principal: Principal,
  input: z.infer<typeof caseRecordTransitionInput>,
) {
  const [c] = await sql<{ org_id: string; employee_id: string; current_status: string; user_id: string | null }[]>`
    select c.org_id, c.employee_id, c.current_status, e.user_id
    from app.immigration_cases c join app.employees e on e.id = c.employee_id
    where c.id = ${input.case_id}`;
  if (!c) return { ok: false as const, error: 'case not found' };
  // Writing requires UPDATE on case internals (employees can't advance their own case).
  requirePermission(principal, {
    resource: 'case_internals',
    action: 'update',
    context: { employeeId: c.employee_id, ownerUserId: c.user_id ?? undefined, orgId: c.org_id },
  });
  const [tr] = await sql`
    insert into app.case_transitions (org_id, case_id, from_status, to_status, transition_key,
      initiated_by, filed_on, receipt_number)
    values (${c.org_id}, ${input.case_id}, ${c.current_status}, ${input.to_status},
      ${input.transition_key ?? null}, ${principal.userId}, ${input.filed_on ?? null}, ${input.receipt_number ?? null})
    returning id`;
  await sql`update app.immigration_cases set current_status = ${input.to_status}, updated_at = now() where id = ${input.case_id}`;
  return { ok: true as const, transition_id: tr!.id as string, from: c.current_status, to: input.to_status };
}
