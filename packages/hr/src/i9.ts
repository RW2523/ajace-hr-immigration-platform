/**
 * I-9 / E-Verify service (§8, A.8). Deadlines are computed from the versioned
 * rules (business days), never constants: Section 2 within N business days of the
 * first day; E-Verify case within N business days of hire; retention = 3 years
 * after hire OR 1 year after termination, whichever is later.
 *
 * The alternative remote examination procedure is allowed ONLY for E-Verify
 * employers in good standing; this service enforces that gate.
 */
import type postgres from 'postgres';
import { RuleIndex, i9Deadlines } from '@hr/rules-engine';
import { requirePermission, type AuditSink, type Principal, type RuleRow } from '@hr/shared';

export interface I9Timeline {
  section2Due: string;
  everifyDue: string;
  retentionUntil: string;
  rulesCited: string[];
  counselPending: boolean;
}

const MS_PER_DAY = 86_400_000;
function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}
function addYears(dateISO: string, years: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return iso(d);
}
function laterOf(a: string, b: string): string {
  return a >= b ? a : b;
}

/** Compute I-9 retention: max(hire + 3y, termination + 1y). */
export function i9Retention(hireDate: string, terminationDate: string | null): string {
  const threeAfterHire = addYears(hireDate, 3);
  if (!terminationDate) return threeAfterHire;
  const oneAfterTerm = addYears(terminationDate, 1);
  return laterOf(threeAfterHire, oneAfterTerm);
}

async function loadRules(sql: postgres.Sql): Promise<RuleIndex> {
  const rows = await sql<RuleRow[]>`
    select rule_id, status_or_transition_key, attribute, value, value_type,
      to_char(effective_date,'YYYY-MM-DD') as effective_date, source_url, source_citation,
      confirmed_by_counsel, superseded_by, to_char(last_verified,'YYYY-MM-DD') as last_verified, notes
    from app.rules where status_or_transition_key = 'all'`;
  return new RuleIndex(rows as unknown as RuleRow[]);
}

export async function computeI9Timeline(
  sql: postgres.Sql,
  hireDate: string,
  terminationDate: string | null,
  asOf: string,
): Promise<I9Timeline> {
  const index = await loadRules(sql);
  const deadlines = i9Deadlines(hireDate, index, asOf);
  return {
    section2Due: deadlines?.section2Due ?? businessDaysFallback(hireDate, 3),
    everifyDue: deadlines?.everifyDue ?? businessDaysFallback(hireDate, 3),
    retentionUntil: i9Retention(hireDate, terminationDate),
    rulesCited: deadlines?.rulesCited ?? [],
    counselPending: deadlines?.counselPending ?? true,
  };
}

function businessDaysFallback(hireDate: string, n: number): string {
  let d = new Date(`${hireDate}T00:00:00Z`);
  let added = 0;
  while (added < n) {
    d = new Date(d.getTime() + MS_PER_DAY);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return iso(d);
}

export interface CreateI9Input {
  employeeId: string;
  hireDate: string;
  listADoc?: string;
  listBDoc?: string;
  listCDoc?: string;
  everifyCaseId?: string;
  alternativeProcedure?: boolean;
  employerEverifyGoodStanding?: boolean;
}

export async function createI9Record(
  sql: postgres.Sql,
  input: CreateI9Input,
  asOf: string,
): Promise<{ id: string; timeline: I9Timeline }> {
  // Document rule: exactly List A, OR List B + List C.
  const hasA = !!input.listADoc;
  const hasBC = !!input.listBDoc && !!input.listCDoc;
  if (!hasA && !hasBC) {
    throw new Error('I-9 requires one List A document OR both a List B and a List C document');
  }
  if (hasA && (input.listBDoc || input.listCDoc)) {
    throw new Error('I-9 accepts EITHER List A OR List B+C, not both');
  }
  // Alternative remote procedure gate (§8): E-Verify good standing required.
  if (input.alternativeProcedure && !input.employerEverifyGoodStanding) {
    throw new Error('Alternative remote I-9 procedure requires an E-Verify employer in good standing');
  }

  const empRows = await sql<{ org_id: string; termination_date: string | null }[]>`
    select org_id, to_char(termination_date,'YYYY-MM-DD') as termination_date
    from app.employees where id = ${input.employeeId}`;
  const emp = empRows[0];
  if (!emp) throw new Error('employee not found');
  const { org_id, termination_date } = emp;
  const timeline = await computeI9Timeline(sql, input.hireDate, termination_date, asOf);

  const [row] = await sql`
    insert into app.i9_records (org_id, employee_id, section2_due, everify_due, list_a_doc,
      list_b_doc, list_c_doc, everify_case_id, alternative_procedure, retention_until)
    values (${org_id}, ${input.employeeId}, ${timeline.section2Due}, ${timeline.everifyDue},
      ${input.listADoc ?? null}, ${input.listBDoc ?? null}, ${input.listCDoc ?? null},
      ${input.everifyCaseId ?? null}, ${input.alternativeProcedure ?? false}, ${timeline.retentionUntil})
    returning id`;
  return { id: row!.id as string, timeline };
}

// ── Authorized product flow ────────────────────────────────────────────────
// createI9Record above is a pure persistence primitive (no authz) kept for the
// rules/retention tests. The functions below are the product entry points: they
// load the target row FIRST, authorize with the requireContext pattern against the
// real org/identity, constrain the write by org, audit, and push the computed
// Section 2 / E-Verify deadlines into app.case_dates so the notification scan
// (packages/notifications/src/run-scan.ts, which reads ONLY app.case_dates) reminds
// on them. The I-9 date_types are `i9_section2_deadline` and `everify_case_deadline`
// (data/immigration-seed/notification_triggers.json).

interface I9Ctx {
  id: string;
  orgId: string;
  employeeId: string;
  ownerUserId: string | null;
}

async function loadI9Ctx(sql: postgres.Sql, i9RecordId: string): Promise<I9Ctx | null> {
  const [row] = await sql<{ id: string; org_id: string; employee_id: string; user_id: string | null }[]>`
    select r.id, r.org_id, r.employee_id, e.user_id
    from app.i9_records r join app.employees e on e.id = r.employee_id
    where r.id = ${i9RecordId}`;
  return row ? { id: row.id, orgId: row.org_id, employeeId: row.employee_id, ownerUserId: row.user_id } : null;
}

/**
 * Ensure there is an immigration case to hang the I-9 deadlines on. The scan
 * resolves recipients via app.immigration_cases, and app.case_dates.case_id is a
 * NOT NULL FK to it — so a tracked I-9 deadline needs a case. Reuses an open case
 * if present; otherwise opens a minimal one keyed to the employee's work
 * authorization category (set during immigration intake).
 */
async function ensureImmigrationCaseId(
  sql: postgres.Sql,
  employeeId: string,
  orgId: string,
): Promise<string> {
  const [existing] = await sql<{ id: string }[]>`
    select id from app.immigration_cases
    where employee_id = ${employeeId} and closed_at is null
    order by opened_at desc limit 1`;
  if (existing) return existing.id;

  const [emp] = await sql<{ work_authorization_category: string | null }[]>`
    select work_authorization_category from app.employees where id = ${employeeId}`;
  const status = emp?.work_authorization_category;
  if (!status) {
    throw new Error(
      'cannot track I-9 deadlines: employee has no work authorization category. Complete immigration intake first.',
    );
  }
  const [row] = await sql<{ id: string }[]>`
    insert into app.immigration_cases (org_id, employee_id, current_status)
    values (${orgId}, ${employeeId}, ${status})
    returning id`;
  return row!.id;
}

/** Push the computed I-9 deadlines into app.case_dates (the scan's sole input). */
async function writeI9Deadlines(
  sql: postgres.Sql,
  caseId: string,
  orgId: string,
  timeline: I9Timeline,
): Promise<void> {
  await sql`
    insert into app.case_dates (org_id, case_id, date_type, value, source, notes)
    values (${orgId}, ${caseId}, 'i9_section2_deadline', ${timeline.section2Due}, 'i9', 'derived from hire date')
    on conflict (case_id, date_type) where date_type in ('i9_section2_deadline','everify_case_deadline')
    do update set value = excluded.value, source = excluded.source, updated_at = now()`;
  await sql`
    insert into app.case_dates (org_id, case_id, date_type, value, source, notes)
    values (${orgId}, ${caseId}, 'everify_case_deadline', ${timeline.everifyDue}, 'i9', 'derived from hire date')
    on conflict (case_id, date_type) where date_type in ('i9_section2_deadline','everify_case_deadline')
    do update set value = excluded.value, source = excluded.source, updated_at = now()`;
}

/**
 * Open/create an I-9 record for an employee (List A OR List B+C document
 * references) and register its Section 2 / E-Verify deadlines with the
 * notification engine. Staff action (HR/Employer over their scope).
 */
export async function openI9Record(
  sql: postgres.Sql,
  audit: AuditSink,
  principal: Principal,
  input: CreateI9Input,
  asOf: string,
): Promise<{ id: string; caseId: string; timeline: I9Timeline }> {
  const [emp] = await sql<{ org_id: string; user_id: string | null }[]>`
    select org_id, user_id from app.employees where id = ${input.employeeId}`;
  if (!emp) throw new Error('employee not found');
  const grant = requirePermission(principal, {
    resource: 'hr_items', action: 'create', requireContext: true,
    context: { orgId: emp.org_id, employeeId: input.employeeId, ownerUserId: emp.user_id ?? undefined },
  });

  const { id, timeline } = await createI9Record(sql, input, asOf);
  const caseId = await ensureImmigrationCaseId(sql, input.employeeId, emp.org_id);
  await writeI9Deadlines(sql, caseId, emp.org_id, timeline);

  await audit.record({
    actorUserId: principal.userId,
    orgId: emp.org_id,
    action: 'sensitive_pii.create',
    resource: `i9_records:${id}`,
    matchedPermission: `${grant.resource}:${grant.action}:${grant.scope}`,
  });
  return { id, caseId, timeline };
}

/** Employer/HR completes Section 2 (employer examination + attestation). */
export async function completeI9Section2(
  sql: postgres.Sql,
  audit: AuditSink,
  principal: Principal,
  i9RecordId: string,
  docs: { listADoc?: string; listBDoc?: string; listCDoc?: string; alternativeProcedure?: boolean; employerEverifyGoodStanding?: boolean } = {},
): Promise<void> {
  const ctx = await loadI9Ctx(sql, i9RecordId);
  if (!ctx) throw new Error('I-9 record not found');
  const grant = requirePermission(principal, {
    resource: 'hr_items', action: 'update', requireContext: true,
    context: { orgId: ctx.orgId, employeeId: ctx.employeeId, ownerUserId: ctx.ownerUserId ?? undefined },
  });
  if (docs.alternativeProcedure && !docs.employerEverifyGoodStanding) {
    throw new Error('Alternative remote I-9 procedure requires an E-Verify employer in good standing');
  }
  await sql`
    update app.i9_records set
      section2_completed_at = now(),
      list_a_doc = coalesce(${docs.listADoc ?? null}, list_a_doc),
      list_b_doc = coalesce(${docs.listBDoc ?? null}, list_b_doc),
      list_c_doc = coalesce(${docs.listCDoc ?? null}, list_c_doc),
      alternative_procedure = coalesce(${docs.alternativeProcedure ?? null}, alternative_procedure)
    where id = ${i9RecordId} and org_id = ${ctx.orgId}`;
  await audit.record({
    actorUserId: principal.userId,
    orgId: ctx.orgId,
    action: 'sensitive_pii.update',
    resource: `i9_records:${i9RecordId}`,
    matchedPermission: `${grant.resource}:${grant.action}:${grant.scope}`,
  });
}

/** Record the E-Verify case id (created within 3 business days of hire). */
export async function recordEverifyCase(
  sql: postgres.Sql,
  audit: AuditSink,
  principal: Principal,
  i9RecordId: string,
  everifyCaseId: string,
): Promise<void> {
  const ctx = await loadI9Ctx(sql, i9RecordId);
  if (!ctx) throw new Error('I-9 record not found');
  const grant = requirePermission(principal, {
    resource: 'hr_items', action: 'update', requireContext: true,
    context: { orgId: ctx.orgId, employeeId: ctx.employeeId, ownerUserId: ctx.ownerUserId ?? undefined },
  });
  await sql`
    update app.i9_records set everify_case_id = ${everifyCaseId}
    where id = ${i9RecordId} and org_id = ${ctx.orgId}`;
  await audit.record({
    actorUserId: principal.userId,
    orgId: ctx.orgId,
    action: 'sensitive_pii.update',
    resource: `i9_records:${i9RecordId}`,
    matchedPermission: `${grant.resource}:${grant.action}:${grant.scope}`,
  });
}

/** Employee attests Section 1 for their OWN I-9 record (day-one deadline). */
export async function completeI9Section1(
  sql: postgres.Sql,
  audit: AuditSink,
  principal: Principal,
  i9RecordId: string,
): Promise<void> {
  const ctx = await loadI9Ctx(sql, i9RecordId);
  if (!ctx) throw new Error('I-9 record not found');
  // Section 1 is the employee's own attestation → sensitive_pii:update, owner-gated.
  const grant = requirePermission(principal, {
    resource: 'sensitive_pii', action: 'update', requireContext: true,
    context: { orgId: ctx.orgId, employeeId: ctx.employeeId, ownerUserId: ctx.ownerUserId ?? undefined },
  });
  await sql`
    update app.i9_records set section1_completed_at = now()
    where id = ${i9RecordId} and org_id = ${ctx.orgId}`;
  await audit.record({
    actorUserId: principal.userId,
    orgId: ctx.orgId,
    action: 'sensitive_pii.update',
    resource: `i9_records:${i9RecordId}`,
    matchedPermission: `${grant.resource}:${grant.action}:${grant.scope}`,
  });
}
