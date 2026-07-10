/**
 * Offboarding → immigration grace-period clock (§8, §7.4). When offboarding
 * completes, the relevant grace clock starts: H-1B 60-day grace on termination,
 * F-1 60-day grace after OPT. The grace length is read from the versioned rules /
 * status data, never a constant, and a tracked date is written so the notification
 * engine escalates the grace-period end to HR and counsel.
 */
import type postgres from 'postgres';
import type { RuleRow, StatusRow } from '@hr/shared';

const MS_PER_DAY = 86_400_000;
function addDays(iso: string, n: number): string {
  return new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * MS_PER_DAY).toISOString().slice(0, 10);
}

export interface OffboardingResult {
  employeeId: string;
  graceStatus: string | null;
  graceDays: number | null;
  graceEndsOn: string | null;
  ruleCited: string | null;
}

/** Resolve grace days for a status from rules (termination grace) or the status row. */
async function graceDaysFor(sql: postgres.Sql, status: string): Promise<{ days: number; ruleId: string | null } | null> {
  const ruleRows = await sql<RuleRow[]>`
    select rule_id, value from app.rules
    where status_or_transition_key = ${status}
      and attribute in ('termination_grace_period_days','grace_period_days','grace_period_days_after_program_or_opt')
      and superseded_by is null
    limit 1`;
  if (ruleRows[0]) {
    const v = Number((ruleRows[0] as unknown as { value: number }).value);
    if (!Number.isNaN(v)) return { days: v, ruleId: (ruleRows[0] as unknown as RuleRow).rule_id };
  }
  const statusRows = await sql<StatusRow[]>`select grace_period_days from app.statuses where key = ${status}`;
  const gd = statusRows[0]?.grace_period_days;
  if (gd != null) return { days: gd, ruleId: null };
  return null;
}

export class OffboardingWorkflow {
  constructor(private sql: postgres.Sql) {}

  /** Complete offboarding for an employee and start the grace clock. */
  async complete(offboardingId: string, lastDay: string): Promise<OffboardingResult> {
    const [ob] = await this.sql<{ org_id: string; employee_id: string; grace_clock_started: boolean }[]>`
      select org_id, employee_id, grace_clock_started from app.offboarding where id = ${offboardingId}`;
    if (!ob) throw new Error('offboarding record not found');

    const [c] = await this.sql<{ id: string; current_status: string }[]>`
      select id, current_status from app.immigration_cases where employee_id = ${ob.employee_id}
      order by opened_at desc limit 1`;

    let result: OffboardingResult = {
      employeeId: ob.employee_id,
      graceStatus: null,
      graceDays: null,
      graceEndsOn: null,
      ruleCited: null,
    };

    await this.sql.begin(async (tx) => {
      await tx`update app.offboarding set status = 'complete', last_day = ${lastDay},
                 grace_clock_started = true, updated_at = now() where id = ${offboardingId}`;
      await tx`update app.employees set termination_date = ${lastDay}, status = 'offboarded', updated_at = now()
               where id = ${ob.employee_id}`;

      if (c && !ob.grace_clock_started) {
        const grace = await graceDaysFor(this.sql, c.current_status);
        if (grace) {
          const endsOn = addDays(lastDay, grace.days);
          const dateType = c.current_status.startsWith('h1b') ? 'h1b_grace_period_end' : 'opt_grace_period_end';
          await tx`insert into app.case_dates (org_id, case_id, date_type, value, source, notes)
                   values (${ob.org_id}, ${c.id}, ${dateType}, ${endsOn}, 'offboarding',
                     ${'Grace period started on offboarding (' + grace.days + ' days from last day)'})`;
          result = {
            employeeId: ob.employee_id,
            graceStatus: c.current_status,
            graceDays: grace.days,
            graceEndsOn: endsOn,
            ruleCited: grace.ruleId,
          };
        }
      }
    });

    return result;
  }
}
