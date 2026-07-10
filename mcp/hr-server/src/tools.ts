/**
 * hr-server tool logic (§11.1). HR lifecycle actions, each authorized server-side
 * against the caller's Principal and scoped to the employees they may act on.
 */
import type postgres from 'postgres';
import { z } from 'zod';
import { requirePermission, type Principal } from '@hr/shared';
import { generateOfferLetter, startOnboarding, type OfferLetterVariables } from '@hr/hr';

async function employeeContext(sql: postgres.Sql, employeeId: string) {
  const [e] = await sql<{ org_id: string; user_id: string | null }[]>`
    select org_id, user_id from app.employees where id = ${employeeId}`;
  return e ?? null;
}

// ── hr_get_onboarding_status ────────────────────────────────────────────────
export const hrOnboardingInput = z.object({ employee_id: z.string().uuid(), category: z.string() });
export async function hrGetOnboardingStatus(sql: postgres.Sql, principal: Principal, input: z.infer<typeof hrOnboardingInput>) {
  const e = await employeeContext(sql, input.employee_id);
  if (!e) return { found: false as const, items: [] };
  requirePermission(principal, {
    resource: 'hr_items',
    action: 'read',
    context: { employeeId: input.employee_id, ownerUserId: e.user_id ?? undefined, orgId: e.org_id },
  });
  const { items } = await startOnboarding(sql, input.employee_id, input.category);
  return { found: true as const, items };
}

// ── hr_create_leave_request ─────────────────────────────────────────────────
export const hrLeaveInput = z.object({
  employee_id: z.string().uuid(),
  leave_type: z.string(),
  start_date: z.string(),
  end_date: z.string(),
});
export async function hrCreateLeaveRequest(sql: postgres.Sql, principal: Principal, input: z.infer<typeof hrLeaveInput>) {
  const e = await employeeContext(sql, input.employee_id);
  if (!e) return { ok: false as const, error: 'employee not found' };
  requirePermission(principal, {
    resource: 'hr_items',
    action: 'create',
    context: { employeeId: input.employee_id, ownerUserId: e.user_id ?? undefined, orgId: e.org_id },
  });
  const [row] = await sql`
    insert into app.leave_requests (org_id, employee_id, leave_type, start_date, end_date, status)
    values (${e.org_id}, ${input.employee_id}, ${input.leave_type}, ${input.start_date}, ${input.end_date}, 'requested')
    returning id`;
  return { ok: true as const, leave_request_id: row!.id as string, status: 'requested' };
}

// ── hr_get_review_cycle ─────────────────────────────────────────────────────
export const hrReviewInput = z.object({ employee_id: z.string().uuid() });
export async function hrGetReviewCycle(sql: postgres.Sql, principal: Principal, input: { employee_id: string }) {
  const e = await employeeContext(sql, input.employee_id);
  if (!e) return { found: false as const, reviews: [] };
  requirePermission(principal, {
    resource: 'hr_items',
    action: 'read',
    context: { employeeId: input.employee_id, ownerUserId: e.user_id ?? undefined, orgId: e.org_id },
  });
  const rows = await sql<{ cycle: string; rating: string | null; status: string }[]>`
    select cycle, rating, status from app.performance_reviews where employee_id = ${input.employee_id} order by created_at desc`;
  return { found: true as const, reviews: rows };
}

// ── hr_list_pending_i9 (sensitive; scoped) ──────────────────────────────────
export const hrPendingI9Input = z.object({ as_of: z.string().optional() });
export async function hrListPendingI9(sql: postgres.Sql, principal: Principal, input: { as_of?: string }) {
  const asOf = input.as_of ?? new Date().toISOString().slice(0, 10);
  // Requires sensitive_pii read; row scope is applied by the caller's grants.
  requirePermission(principal, { resource: 'sensitive_pii', action: 'read' });
  // Restrict to the caller's org (and, for HR without org scope, assigned set).
  const orgWide = principal.permissions.some(
    (p) => p.resource === 'sensitive_pii' && (p.action === 'read' || p.action === 'manage') && (p.scope === 'org' || p.scope === 'global'),
  );
  const rows = await sql<{ employee_id: string; section2_due: string | null; everify_due: string | null }[]>`
    select i.employee_id, to_char(i.section2_due,'YYYY-MM-DD') as section2_due, to_char(i.everify_due,'YYYY-MM-DD') as everify_due
    from app.i9_records i
    where i.org_id = ${principal.orgId}
      and (i.section2_completed_at is null or i.everify_case_id is null)
      and (${orgWide} or i.employee_id = any(${principal.assignedEmployeeIds}::uuid[]))`;
  return {
    as_of: asOf,
    pending: rows.map((r) => ({ employee_id: r.employee_id, section2_due: r.section2_due, everify_due: r.everify_due })),
  };
}

// ── hr_generate_offer_letter (write) ────────────────────────────────────────
export const hrOfferInput = z.object({
  employee_id: z.string().uuid(),
  variables: z.object({
    employee_name: z.string(),
    role_title: z.string(),
    employment_type: z.enum(['placement', 'direct_hire']),
    start_date: z.string(),
    compensation: z.string(),
    work_location: z.string(),
    employer_name: z.string(),
  }).catchall(z.string()),
});
export async function hrGenerateOfferLetter(sql: postgres.Sql, principal: Principal, input: z.infer<typeof hrOfferInput>) {
  const e = await employeeContext(sql, input.employee_id);
  if (!e) return { ok: false as const, error: 'employee not found' };
  requirePermission(principal, {
    resource: 'hr_items',
    action: 'create',
    context: { employeeId: input.employee_id, ownerUserId: e.user_id ?? undefined, orgId: e.org_id },
  });
  const result = await generateOfferLetter(sql, input.employee_id, input.variables as OfferLetterVariables);
  return { ok: true as const, offer_letter_id: result.id, preview: result.text.slice(0, 400) };
}
