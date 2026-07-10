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
import { loadRuleData, validateCase, type CaseSnapshot } from '@hr/rules-engine';

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

export class CaseEngine {
  constructor(private sql: postgres.Sql) {}

  private async snapshot(caseId: string): Promise<{ snapshot: CaseSnapshot; orgId: string }> {
    const [c] = await this.sql<{ org_id: string; current_status: string }[]>`
      select org_id, current_status from app.immigration_cases where id = ${caseId}`;
    if (!c) throw new Error('case not found');
    const dateRows = await this.sql<{ date_type: string; value: string }[]>`
      select date_type, to_char(value,'YYYY-MM-DD') as value from app.case_dates where case_id = ${caseId}`;
    const docRows = await this.sql<{ document_type: string }[]>`
      select document_type from app.documents where case_id = ${caseId}`;
    const dates: Record<string, string> = {};
    for (const r of dateRows) dates[r.date_type] = r.value;
    return {
      orgId: c.org_id,
      snapshot: {
        currentStatus: c.current_status,
        dates,
        collectedDocuments: docRows.map((d) => d.document_type),
        attributes: {},
      },
    };
  }

  /** Advance a case, validating eligibility against the rules unless forced. */
  async advance(input: AdvanceInput, asOf: string): Promise<AdvanceResult> {
    const { snapshot, orgId } = await this.snapshot(input.caseId);
    const fromStatus = snapshot.currentStatus;

    if (!input.force) {
      const data = await loadRuleData(this.sql);
      const result = validateCase(data, snapshot, asOf);
      const target =
        result.eligibleTransitions.find((t) => t.toStatus === input.toStatus) ??
        result.eligibleTransitions.find((t) => t.transitionKey === input.transitionKey);
      if (!target) {
        const blocked = result.ineligibleTransitions.find((t) => t.toStatus === input.toStatus);
        return {
          ok: false,
          caseId: input.caseId,
          fromStatus,
          toStatus: input.toStatus,
          blockedReasons: blocked
            ? [...blocked.unmetPreconditions, ...blocked.missingDocuments.map((d) => `missing document: ${d}`)]
            : [`no eligible transition from ${fromStatus} to ${input.toStatus}`],
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
