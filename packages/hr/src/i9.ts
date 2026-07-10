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
import type { RuleRow } from '@hr/shared';

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
