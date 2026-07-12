/**
 * Case workflow engine (§7, §7.4). Advances a case through the state machine,
 * recording history and derived dates. Designed as a SEPARABLE service (D1): this
 * is the queue+cron implementation behind a stable interface a Temporal worker can
 * replace later without changing callers.
 *
 * The engine validates a transition against the versioned rules (via the pure
 * validator) before applying it, and models the generic filing sub-machine:
 *   filed → receipt → [rfe → response] → approved | denied → [refile]
 */
import type postgres from 'postgres';
import { addDays, daysBetween, loadRuleData, validateCase, type CaseSnapshot } from '@hr/rules-engine';

export interface AdvanceInput {
  caseId: string;
  toStatus: string;
  transitionKey?: string;
  initiatedBy?: string;
  filedOn?: string;
  receiptNumber?: string;
  /** Derived dates to record on the case (date_type → ISO date). */
  datesToRecord?: Record<string, string>;
  /** Bypass eligibility validation (e.g. admin correction). Logged by caller. */
  force?: boolean;
}

export interface AdvanceResult {
  ok: boolean;
  caseId: string;
  fromStatus: string;
  toStatus: string;
  transitionId?: string;
  blockedReasons?: string[];
}

/**
 * Pure interval math for Bug 5: aggregate calendar days of unemployment inside the
 * OPT window [optStart, windowEnd] (inclusive), given employment (placement)
 * intervals. Placements are clipped to the window and merged; unemployment is the
 * window days not covered by any placement. An open-ended placement (null end)
 * counts as employed through windowEnd. Dates are ISO (YYYY-MM-DD).
 */
export function unemploymentDaysFromIntervals(
  placements: ReadonlyArray<{ start_date: string | null; end_date: string | null }>,
  optStart: string,
  windowEnd: string,
): number {
  if (windowEnd <= optStart) return 0;
  const intervals = placements
    .filter((p) => p.start_date)
    .map((p) => ({
      start: p.start_date! < optStart ? optStart : p.start_date!,
      end: !p.end_date || p.end_date > windowEnd ? windowEnd : p.end_date,
    }))
    .filter((iv) => iv.start <= iv.end)
    .sort((a, b) => a.start.localeCompare(b.start));

  let employedDays = 0;
  let cursor: string | null = null; // last covered day (inclusive)
  for (const iv of intervals) {
    const from = cursor && iv.start <= cursor ? addDays(cursor, 1) : iv.start;
    if (from > iv.end) continue; // fully covered by a prior interval
    employedDays += daysBetween(from, iv.end) + 1; // inclusive day count
    cursor = iv.end > (cursor ?? '') ? iv.end : cursor;
  }

  const windowDays = daysBetween(optStart, windowEnd) + 1;
  return Math.max(0, windowDays - employedDays);
}

/**
 * Canonical case-snapshot builder — the SINGLE source of truth for turning a case's
 * stored rows into a CaseSnapshot for the validator. The web case page, the MCP
 * case-server, and the CaseEngine all use this, so eligibility/findings never differ
 * by caller (previously the web page hard-coded an empty document list and diverged).
 */
export async function buildCaseSnapshot(
  sql: postgres.Sql,
  caseId: string,
  asOf: string,
): Promise<{ snapshot: CaseSnapshot; orgId: string; employeeId: string }> {
  const [c] = await sql<{ org_id: string; current_status: string; employee_id: string }[]>`
    select org_id, current_status, employee_id from app.immigration_cases where id = ${caseId}`;
  if (!c) throw new Error('case not found');
  const dateRows = await sql<{ date_type: string; value: string }[]>`
    select date_type, to_char(value,'YYYY-MM-DD') as value from app.case_dates where case_id = ${caseId}`;
  const docRows = await sql<{ document_type: string }[]>`
    select document_type from app.documents where case_id = ${caseId}`;
  const dates: Record<string, string> = {};
  for (const r of dateRows) dates[r.date_type] = r.value;

  // Compute unemployment days used from real placement gaps for OPT statuses; leave
  // UNDEFINED when unanchored so the validator reports "unknown / counsel review"
  // rather than a confident 0/limit.
  const unemploymentDaysUsed =
    c.current_status === 'f1_opt' || c.current_status === 'f1_stem_opt'
      ? await computeUnemploymentDaysUsed(sql, c.employee_id, dates, asOf)
      : undefined;

  return {
    orgId: c.org_id,
    employeeId: c.employee_id,
    snapshot: {
      currentStatus: c.current_status,
      dates,
      collectedDocuments: docRows.map((d) => d.document_type),
      attributes: {},
      ...(unemploymentDaysUsed !== undefined ? { unemploymentDaysUsed } : {}),
    },
  };
}

/**
 * Aggregate calendar days of unemployment during the post-completion OPT period,
 * computed from placement (employment) intervals. Returns UNDEFINED (→ validator
 * reports "unknown") when there is no OPT anchor date or no placement rows at all,
 * so we never fabricate a count. A laid-off employee whose placement ENDED has a
 * row with an end_date, so their post-layoff gap IS counted. Mechanical day count,
 * not a legal determination — the validator's finding stays counsel-pending.
 */
async function computeUnemploymentDaysUsed(
  sql: postgres.Sql,
  employeeId: string,
  dates: Record<string, string>,
  asOf: string,
): Promise<number | undefined> {
  const optStart = dates['opt_ead_start'] ?? dates['ead_start'];
  if (!optStart) return undefined; // no anchor → unknown
  const windowEnd = dates['opt_ead_expiry'] && dates['opt_ead_expiry'] < asOf ? dates['opt_ead_expiry'] : asOf;
  if (windowEnd <= optStart) return 0;

  const placements = await sql<{ start_date: string | null; end_date: string | null }[]>`
    select to_char(start_date,'YYYY-MM-DD') as start_date, to_char(end_date,'YYYY-MM-DD') as end_date
    from app.placements where employee_id = ${employeeId}`;
  if (placements.length === 0) return undefined; // no employment data → unknown

  return unemploymentDaysFromIntervals(placements, optStart, windowEnd);
}

export class CaseEngine {
  constructor(private sql: postgres.Sql) {}

  private async snapshot(caseId: string, asOf: string): Promise<{ snapshot: CaseSnapshot; orgId: string }> {
    return buildCaseSnapshot(this.sql, caseId, asOf);
  }

  /** Advance a case, validating eligibility against the rules unless forced. */
  async advance(input: AdvanceInput, asOf: string): Promise<AdvanceResult> {
    const { snapshot, orgId } = await this.snapshot(input.caseId, asOf);
    const fromStatus = snapshot.currentStatus;

    if (!input.force) {
      const data = await loadRuleData(this.sql);
      const result = validateCase(data, snapshot, asOf);
      const target =
        result.eligibleTransitions.find((t) => t.toStatus === input.toStatus) ??
        result.eligibleTransitions.find((t) => t.transitionKey === input.transitionKey);
      if (!target) {
        // A transition blocked only by preconditions the engine cannot confirm is
        // NOT auto-advanced — counsel must confirm (or the caller uses force).
        const review = result.needsCounselReviewTransitions.find(
          (t) => t.toStatus === input.toStatus || t.transitionKey === input.transitionKey,
        );
        const blocked = result.ineligibleTransitions.find((t) => t.toStatus === input.toStatus);
        const reasons = review
          ? [
              'pending counsel review — preconditions cannot be mechanically confirmed:',
              ...review.unconfirmedPreconditions,
            ]
          : blocked
            ? [...blocked.unmetPreconditions, ...blocked.missingDocuments.map((d) => `missing document: ${d}`)]
            : [`no eligible transition from ${fromStatus} to ${input.toStatus}`];
        return {
          ok: false,
          caseId: input.caseId,
          fromStatus,
          toStatus: input.toStatus,
          blockedReasons: reasons,
        };
      }
    }

    return this.sql.begin(async (tx) => {
      const [tr] = await tx`
        insert into app.case_transitions (org_id, case_id, from_status, to_status, transition_key,
          initiated_by, filed_on, receipt_number)
        values (${orgId}, ${input.caseId}, ${fromStatus}, ${input.toStatus}, ${input.transitionKey ?? null},
          ${input.initiatedBy ?? null}, ${input.filedOn ?? null}, ${input.receiptNumber ?? null})
        returning id`;
      await tx`update app.immigration_cases set current_status = ${input.toStatus}, updated_at = now()
               where id = ${input.caseId}`;
      for (const [dateType, value] of Object.entries(input.datesToRecord ?? {})) {
        await tx`insert into app.case_dates (org_id, case_id, date_type, value, source)
                 values (${orgId}, ${input.caseId}, ${dateType}, ${value}, 'workflow')`;
      }
      return { ok: true, caseId: input.caseId, fromStatus, toStatus: input.toStatus, transitionId: (tr!.id as string) };
    });
  }

  /** Record an RFE on the most recent transition and set its response deadline. */
  async recordRFE(caseId: string, rfeDueDate: string): Promise<void> {
    const [c] = await this.sql<{ org_id: string }[]>`select org_id from app.immigration_cases where id = ${caseId}`;
    if (!c) throw new Error('case not found');
    await this.sql`update app.case_transitions set decision = 'rfe'
                   where id = (select id from app.case_transitions where case_id = ${caseId} order by created_at desc limit 1)`;
    await this.sql`insert into app.case_dates (org_id, case_id, date_type, value, source)
                   values (${c.org_id}, ${caseId}, 'rfe_response_deadline', ${rfeDueDate}, 'workflow')`;
  }

  /** Record a decision (approved/denied) on the most recent transition. */
  async recordDecision(caseId: string, decision: 'approved' | 'denied', decisionDate: string): Promise<void> {
    await this.sql`update app.case_transitions set decision = ${decision}, decision_date = ${decisionDate}
                   where id = (select id from app.case_transitions where case_id = ${caseId} order by created_at desc limit 1)`;
  }
}
