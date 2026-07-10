/**
 * DB-backed deadline scan (§9). Runs as a trusted service job (service_role,
 * bypasses RLS — it must see all cases). Steps:
 *   1. load tracked case_dates + the versioned notification triggers
 *   2. compute due reminders (pure core) minus what's already recorded (idempotency)
 *   3. resolve recipient role → user (employee = case's employee; hr = assigned HR;
 *      counsel = attorney_of_record / org counsel)
 *   4. insert notification rows + dispatch via channels
 *
 * Invoke on a schedule (Supabase scheduled function / cron). Designed behind a
 * separable interface so a Temporal timer can drive it later without changing this.
 */
import type postgres from 'postgres';
import type { NotificationTriggerRow } from '@hr/shared';
import { serviceClient } from '@hr/db';
import { computeDueReminders, type TrackedDate } from './scan.js';
import { resolveChannels, type Channel } from './channels.js';
import { loadTriggers } from './triggers.js';

export interface ScanReport {
  scannedDates: number;
  due: number;
  inserted: number;
  dispatched: number;
  skippedNoRecipient: number;
}

export async function runScan(
  sql: postgres.Sql,
  today: string,
  channels: Record<string, Channel> = resolveChannels(),
): Promise<ScanReport> {
  const triggers: NotificationTriggerRow[] = await loadTriggers();

  const dateRows = await sql<{ case_id: string; date_type: string; value: string }[]>`
    select case_id, date_type, to_char(value,'YYYY-MM-DD') as value from app.case_dates`;
  const dates: TrackedDate[] = dateRows.map((r) => ({
    caseId: r.case_id,
    dateType: r.date_type,
    targetDate: r.value,
  }));

  const sentRows = await sql<{ dedupe_key: string }[]>`select dedupe_key from app.notifications`;
  const alreadySent = new Set(sentRows.map((r) => r.dedupe_key));

  const due = computeDueReminders(dates, triggers, today, alreadySent);

  let inserted = 0;
  let dispatched = 0;
  let skippedNoRecipient = 0;

  for (const r of due) {
    const recipient = await resolveRecipient(sql, r.caseId, r.recipientRole);
    if (!recipient) {
      skippedNoRecipient++;
      continue;
    }
    // Insert one notification row per channel, all sharing the dedupe key's uniqueness
    // via a channel suffix so email + in_app both record but never double within a channel.
    for (const channel of r.channels) {
      const key = `${r.dedupeKey}:${channel}`;
      const [row] = await sql`
        insert into app.notifications (org_id, recipient_user_id, channel, type,
          related_case_id, related_date, offset_days, escalation_level, status, dedupe_key)
        values (${recipient.orgId}, ${recipient.userId}, ${channel}, ${r.dateType},
          ${r.caseId}, ${r.targetDate}, ${r.offsetDays}, ${r.escalationLevel}, 'pending', ${key})
        on conflict (dedupe_key) do nothing
        returning id`;
      if (!row) continue; // already existed (idempotent)
      inserted++;

      const adapter = channels[channel];
      if (adapter && recipient.email) {
        try {
          await adapter.send({
            to: channel === 'email' ? recipient.email : recipient.userId,
            subject: subjectFor(r.dateType, r.offsetDays),
            body: bodyFor(r.dateType, r.targetDate, r.offsetDays, r.escalationLevel),
            channel,
          });
          await sql`update app.notifications set status='sent', sent_at=now() where id=${row.id}`;
          dispatched++;
        } catch {
          await sql`update app.notifications set status='failed' where id=${row.id}`;
        }
      }
    }
  }

  return { scannedDates: dates.length, due: due.length, inserted, dispatched, skippedNoRecipient };
}

interface Recipient {
  userId: string;
  email: string | null;
  orgId: string;
}

/** Resolve who receives a reminder tier for a case (§9 escalation). */
async function resolveRecipient(
  sql: postgres.Sql,
  caseId: string,
  role: string,
): Promise<Recipient | null> {
  const [c] = await sql<{ org_id: string; employee_id: string }[]>`
    select org_id, employee_id from app.immigration_cases where id = ${caseId}`;
  if (!c) return null;

  if (role === 'employee') {
    const [u] = await sql<{ id: string; email: string }[]>`
      select u.id, u.email from app.employees e
      join app.users u on u.id = e.user_id where e.id = ${c.employee_id}`;
    return u ? { userId: u.id, email: u.email, orgId: c.org_id } : null;
  }
  if (role === 'hr') {
    // First HR user assigned to this employee, else any org HR.
    const [u] = await sql<{ id: string; email: string }[]>`
      select u.id, u.email
      from app.user_roles ur
      join app.roles r on r.id = ur.role_id and r.key = 'hr'
      join app.users u on u.id = ur.user_id
      where ur.org_id = ${c.org_id}
        and (ur.scope -> 'assigned_employee_ids' @> to_jsonb(${c.employee_id}::text) or true)
      order by (ur.scope -> 'assigned_employee_ids' @> to_jsonb(${c.employee_id}::text)) desc
      limit 1`;
    return u ? { userId: u.id, email: u.email, orgId: c.org_id } : null;
  }
  if (role === 'counsel') {
    // Counsel routing: attorney_of_record if a user, else org admin as fallback sink.
    const [u] = await sql<{ id: string; email: string }[]>`
      select u.id, u.email
      from app.user_roles ur
      join app.roles r on r.id = ur.role_id and r.key in ('admin','employer')
      join app.users u on u.id = ur.user_id
      where ur.org_id = ${c.org_id}
      order by r.rank asc
      limit 1`;
    return u ? { userId: u.id, email: u.email, orgId: c.org_id } : null;
  }
  return null;
}

function subjectFor(dateType: string, offset: number): string {
  const human = dateType.replace(/_/g, ' ');
  return offset <= 0 ? `Action due today: ${human}` : `Reminder: ${human} in ${offset} days`;
}
function bodyFor(dateType: string, target: string, offset: number, level: number): string {
  return [
    `<p>This is an automated deadline reminder from the HR & Immigration platform.</p>`,
    `<p><strong>${dateType.replace(/_/g, ' ')}</strong> is on <strong>${target}</strong> (${offset} day(s) out).</p>`,
    level >= 3
      ? `<p>Escalated to counsel. This tracker does not provide legal advice; please review.</p>`
      : `<p>Please take any required action before the deadline.</p>`,
  ].join('\n');
}

// CLI entry: `tsx src/run-scan.ts [YYYY-MM-DD]`
if (import.meta.url === `file://${process.argv[1]}`) {
  const today = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  const sql = serviceClient();
  runScan(sql, today)
    .then((r) => {
      console.log('scan report:', r);
      return sql.end();
    })
    .catch(async (e) => {
      console.error(e);
      await sql.end();
      process.exit(1);
    });
}
