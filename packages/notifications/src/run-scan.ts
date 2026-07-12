/**
 * DB-backed deadline scan (§9). Runs as a trusted service job (service_role,
 * bypasses RLS — it must see all cases). Steps:
 *   1. load tracked case_dates + the versioned notification triggers
 *   2. compute due reminders (pure core) minus what's already fully delivered
 *   3. resolve recipient role → user (employee = case's employee; hr = assigned HR;
 *      counsel = counsel-of-record, with an explicit logged fallback)
 *   4. insert notification rows + dispatch via channels, AT LEAST ONCE:
 *      a row is only marked 'sent' after the channel actually succeeds; a failed
 *      send is left retryable (status='failed' + next_attempt_at backoff) so the
 *      next scan retries it, while a successful channel is never re-sent.
 *
 * Invoke on a schedule (Vercel cron / Supabase scheduled function). Designed behind
 * a separable interface so a Temporal timer can drive it later without changing this.
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
  retried: number;
  failed: number;
  skippedNoRecipient: number;
}

export interface RunScanOptions {
  /** Wall clock used for retry gating / backoff. Injectable for simulated-clock tests. */
  now?: Date;
}

/** Retry policy: exponential backoff, capped, with a terminal 'dead' state. */
const RETRY = { baseMs: 15 * 60_000, capMs: 24 * 3_600_000, maxAttempts: 6 } as const;
function backoffMs(attempts: number): number {
  return Math.min(RETRY.baseMs * 2 ** Math.max(0, attempts - 1), RETRY.capMs);
}

export async function runScan(
  sql: postgres.Sql,
  today: string,
  channels: Record<string, Channel> = resolveChannels(sql),
  options: RunScanOptions = {},
): Promise<ScanReport> {
  const now = options.now ?? new Date();
  const triggers: NotificationTriggerRow[] = await loadTriggers();

  const dateRows = await sql<{ case_id: string; date_type: string; value: string }[]>`
    select case_id, date_type, to_char(value,'YYYY-MM-DD') as value from app.case_dates`;
  const dates: TrackedDate[] = dateRows.map((r) => ({
    caseId: r.case_id,
    dateType: r.date_type,
    targetDate: r.value,
  }));

  // Idempotency pre-filter (§9): a reminder (base key) is skipped only when EVERY
  // channel row for it is already 'sent'. Stored keys are channel-suffixed
  // (`${base}:${channel}`), so we strip the trailing channel segment to recover the
  // base key the pure core computes, then keep only fully-delivered ones. Partially
  // delivered / failed reminders fall through so their failed channels get retried.
  const settledRows = await sql<{ base_key: string }[]>`
    select regexp_replace(dedupe_key, ':[^:]+$', '') as base_key
    from app.notifications
    group by regexp_replace(dedupe_key, ':[^:]+$', '')
    having bool_and(status = 'sent')`;
  const alreadySent = new Set(settledRows.map((r) => r.base_key));

  const due = computeDueReminders(dates, triggers, today, alreadySent);

  let inserted = 0;
  let dispatched = 0;
  let retried = 0;
  let failed = 0;
  let skippedNoRecipient = 0;

  for (const r of due) {
    const recipient = await resolveRecipient(sql, r.caseId, r.recipientRole);
    if (!recipient) {
      skippedNoRecipient++;
      continue;
    }
    // One notification row per channel; the channel suffix keeps email + in_app
    // independent while the DB unique(dedupe_key) is the hard idempotency backstop.
    for (const channel of r.channels) {
      const key = `${r.dedupeKey}:${channel}`;

      // Upsert-or-load the row so we can distinguish a fresh send from a retry.
      let [row] = await sql<{ id: string; status: string; attempts: number; next_attempt_at: string | null }[]>`
        insert into app.notifications (org_id, recipient_user_id, channel, type,
          related_case_id, related_date, offset_days, escalation_level, status, dedupe_key)
        values (${recipient.orgId}, ${recipient.userId}, ${channel}, ${r.dateType},
          ${r.caseId}, ${r.targetDate}, ${r.offsetDays}, ${r.escalationLevel}, 'pending', ${key})
        on conflict (dedupe_key) do nothing
        returning id, status, attempts, next_attempt_at`;

      let isNew = false;
      if (row) {
        isNew = true;
        inserted++;
      } else {
        [row] = await sql<{ id: string; status: string; attempts: number; next_attempt_at: string | null }[]>`
          select id, status, attempts, next_attempt_at from app.notifications where dedupe_key = ${key}`;
        if (!row) continue; // race — will be handled next scan
        if (row.status === 'sent') continue; // already delivered on this channel — never double-send
        if (row.status === 'dead') continue; // exhausted retries — do not spam
        // Backoff gate: skip until next_attempt_at has passed.
        if (row.next_attempt_at && new Date(row.next_attempt_at) > now) continue;
        retried++;
      }

      const adapter = channels[channel];
      const needsEmail = channel === 'email';
      if (!adapter) continue;
      if (needsEmail && !recipient.email) {
        // Can't deliver email without an address; record as failed but do not fake success.
        await sql`update app.notifications
          set status='failed', attempts=attempts+1, last_error='no recipient email', next_attempt_at=null
          where id=${row.id}`;
        if (!isNew) failed++;
        continue;
      }

      try {
        await adapter.send({
          to: channel === 'email' ? recipient.email! : recipient.userId,
          subject: subjectFor(r.dateType, r.offsetDays),
          body: bodyFor(r.dateType, r.targetDate, r.offsetDays, r.escalationLevel),
          channel,
          notificationId: row.id,
          link: `/cases/${r.caseId}`,
        });
        await sql`update app.notifications
          set status='sent', sent_at=now(), attempts=attempts+1, last_error=null, next_attempt_at=null
          where id=${row.id}`;
        dispatched++;
      } catch (e) {
        const attempts = (row.attempts ?? 0) + 1;
        const dead = attempts >= RETRY.maxAttempts;
        const nextAt = dead ? null : new Date(now.getTime() + backoffMs(attempts));
        await sql`update app.notifications
          set status=${dead ? 'dead' : 'failed'}, attempts=${attempts},
              last_error=${String((e as Error)?.message ?? e).slice(0, 500)},
              next_attempt_at=${nextAt}
          where id=${row.id}`;
        failed++;
        console.error(`[notifications] send failed (${channel}) key=${key}: ${(e as Error)?.message ?? e}`);
      }
    }
  }

  return { scannedDates: dates.length, due: due.length, inserted, dispatched, retried, failed, skippedNoRecipient };
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
    // Counsel tier → users holding the first-class `counsel` (or `attorney`) role.
    const [u] = await sql<{ id: string; email: string }[]>`
      select u.id, u.email
      from app.user_roles ur
      join app.roles r on r.id = ur.role_id and r.key in ('counsel','attorney')
      join app.users u on u.id = ur.user_id
      where ur.org_id = ${c.org_id}
      order by u.created_at asc
      limit 1`;
    if (u) return { userId: u.id, email: u.email, orgId: c.org_id };
    // Explicit, LOGGED fallback: no counsel configured. We escalate to the highest
    // available org operator (employer/admin) rather than silently pretending it is
    // counsel, and we log so the gap is visible and fixable.
    const [f] = await sql<{ id: string; email: string; key: string }[]>`
      select u.id, u.email, r.key
      from app.user_roles ur
      join app.roles r on r.id = ur.role_id and r.key in ('employer','admin')
      join app.users u on u.id = ur.user_id
      where ur.org_id = ${c.org_id}
      order by r.rank asc
      limit 1`;
    if (f) {
      console.warn(
        `[notifications] no counsel/attorney configured for org ${c.org_id}; ` +
          `escalating case ${caseId} counsel-tier reminder to '${f.key}' (${f.id}) as an explicit fallback.`,
      );
      return { userId: f.id, email: f.email, orgId: c.org_id };
    }
    console.warn(
      `[notifications] no counsel and no employer/admin fallback for org ${c.org_id}; ` +
        `counsel-tier reminder for case ${caseId} could not be routed.`,
    );
    return null;
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
