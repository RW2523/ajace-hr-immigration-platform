/**
 * End-to-end deadline scan against the DB. Seeds a case with a near-term OPT EAD
 * expiry and exercises the production seams under a simulated clock:
 *   - tiered routing incl. the first-class counsel role
 *   - idempotency (no double-insert / no double-send)
 *   - a corrected/renewed date firing a fresh reminder series
 *   - at-least-once retry: a failed channel is retried, a succeeded one is not
 *   - in-app persistence of the bell notification row
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serviceClient } from '@hr/db';
import { ConsoleChannel, InAppChannel, type Channel, type OutboundMessage } from './channels.js';
import { runScan } from './run-scan.js';

const sql = serviceClient();
const ids = {
  org: crypto.randomUUID(),
  uEmp: crypto.randomUUID(),
  uHr: crypto.randomUUID(),
  uCounsel: crypto.randomUUID(),
  uBoss: crypto.randomUUID(),
  emp: crypto.randomUUID(),
  kase: crypto.randomUUID(),
};

// Email as a console sink (no real send); in_app as the real DB-backed bell channel.
function testChannels(): Record<string, Channel> {
  return { email: new ConsoleChannel('email'), in_app: new InAppChannel(sql) };
}

beforeAll(async () => {
  await sql`delete from app.users where email like '%@notif.test'`;
  await sql`delete from app.organizations where name = 'Notif Org'`;
  await sql`insert into app.organizations (id, name) values (${ids.org}, 'Notif Org')`;
  await sql`insert into app.users (id, org_id, email, full_name) values
    (${ids.uEmp}, ${ids.org}, 'emp@notif.test', 'Emp'),
    (${ids.uHr}, ${ids.org}, 'hr@notif.test', 'Hr'),
    (${ids.uCounsel}, ${ids.org}, 'counsel@notif.test', 'Counsel'),
    (${ids.uBoss}, ${ids.org}, 'boss@notif.test', 'Boss')`;
  await sql`insert into app.employees (id, org_id, user_id, full_name, employment_type)
    values (${ids.emp}, ${ids.org}, ${ids.uEmp}, 'Emp', 'direct_hire')`;
  await sql`insert into app.immigration_cases (id, org_id, employee_id, current_status)
    values (${ids.kase}, ${ids.org}, ${ids.emp}, 'f1_opt')`;

  const roleId = async (key: string) => (await sql`select id from app.roles where key=${key}`)[0]!.id;
  const hrRole = await roleId('hr');
  const counselRole = await roleId('counsel');
  const bossRole = await roleId('employer');
  await sql`insert into app.user_roles (user_id, role_id, org_id, scope) values
    (${ids.uHr}, ${hrRole}, ${ids.org}, ${sql.json({ assigned_employee_ids: [ids.emp] } as never)})`;
  await sql`insert into app.user_roles (user_id, role_id, org_id) values
    (${ids.uCounsel}, ${counselRole}, ${ids.org}),
    (${ids.uBoss}, ${bossRole}, ${ids.org})`;
  // OPT EAD expires 2026-11-01; scans below use 2026-10-18 (14 days out).
  await sql`insert into app.case_dates (org_id, case_id, date_type, value)
    values (${ids.org}, ${ids.kase}, 'ead_expiry', date '2026-11-01')`;
});

afterAll(async () => {
  await sql`delete from app.notifications where org_id = ${ids.org}`;
  await sql`delete from app.users where org_id = ${ids.org}`;
  await sql`delete from app.organizations where id = ${ids.org}`;
  await sql.end();
});

describe('DB-backed scan — routing & idempotency', () => {
  it('at 14 days out, notifies employee + HR + counsel (counsel routes to the counsel role)', async () => {
    const report = await runScan(sql, '2026-10-18', testChannels());
    expect(report.due).toBeGreaterThan(0);
    expect(report.inserted).toBeGreaterThan(0);

    const rows = await sql<{ recipient_user_id: string; escalation_level: number }[]>`
      select recipient_user_id, escalation_level from app.notifications
      where related_case_id = ${ids.kase} and offset_days = 14`;
    const recipients = new Set(rows.map((r) => r.recipient_user_id));
    expect(recipients.has(ids.uEmp)).toBe(true);
    expect(recipients.has(ids.uHr)).toBe(true);
    // counsel tier reaches the actual counsel user, NOT the org boss/admin.
    expect(recipients.has(ids.uCounsel)).toBe(true);
    expect(recipients.has(ids.uBoss)).toBe(false);
    const counselRows = rows.filter((r) => r.escalation_level === 3);
    expect(counselRows.every((r) => r.recipient_user_id === ids.uCounsel)).toBe(true);
  });

  it('is idempotent: a second scan on the same day inserts and dispatches nothing new', async () => {
    const before = (await sql`select count(*)::int as n from app.notifications where org_id=${ids.org}`)[0]!.n;
    const report = await runScan(sql, '2026-10-18', testChannels());
    const after = (await sql`select count(*)::int as n from app.notifications where org_id=${ids.org}`)[0]!.n;
    expect(report.inserted).toBe(0);
    expect(report.dispatched).toBe(0);
    expect(after).toBe(before);
  });

  it('a renewed EAD date (new expiry) fires a fresh reminder series', async () => {
    // Renew: EAD reissued to 2027-03-01. The old 2026-11-01 series is fully sent.
    await sql`update app.case_dates set value = date '2027-03-01'
      where case_id = ${ids.kase} and date_type = 'ead_expiry'`;
    const report = await runScan(sql, '2027-02-15', testChannels()); // 14 days before new date
    expect(report.inserted).toBeGreaterThan(0);
    const rows = await sql<{ related_date: string }[]>`
      select to_char(related_date,'YYYY-MM-DD') as related_date from app.notifications
      where related_case_id = ${ids.kase} and offset_days = 14 and escalation_level = 3`;
    expect(rows.some((r) => r.related_date === '2027-03-01')).toBe(true);
    // Restore for isolation of later tests.
    await sql`update app.case_dates set value = date '2026-11-01'
      where case_id = ${ids.kase} and date_type = 'ead_expiry'`;
  });
});

/** Fails the first `failTimes` email sends, then succeeds; records successes. */
class FlakyEmail implements Channel {
  readonly name = 'email';
  sends: string[] = [];
  constructor(private failWhile: () => boolean) {}
  async send(msg: OutboundMessage): Promise<void> {
    if (this.failWhile()) throw new Error('simulated provider outage');
    this.sends.push(msg.notificationId ?? msg.to);
  }
}

describe('at-least-once dispatch (retry, no double-send)', () => {
  const kase2 = crypto.randomUUID();
  beforeAll(async () => {
    await sql`insert into app.immigration_cases (id, org_id, employee_id, current_status)
      values (${kase2}, ${ids.org}, ${ids.emp}, 'f1_opt')`;
    await sql`insert into app.case_dates (org_id, case_id, date_type, value)
      values (${ids.org}, ${kase2}, 'ead_expiry', date '2026-11-01')`;
  });

  it('leaves a failed send retryable, retries after backoff, and never double-sends', async () => {
    const T0 = new Date('2026-10-18T09:00:00Z');
    let outage = true;
    const flaky = new FlakyEmail(() => outage);
    const inApp = new InAppChannel(sql);

    // Scan 1: email provider is down → email rows failed & retryable; in_app succeeds.
    await runScan(sql, '2026-10-18', { email: flaky, in_app: inApp }, { now: T0 });
    let emailRows = await sql<{ status: string; attempts: number }[]>`
      select status, attempts from app.notifications
      where related_case_id = ${kase2} and channel = 'email'`;
    expect(emailRows.length).toBeGreaterThan(0);
    expect(emailRows.every((r) => r.status === 'failed' && r.attempts === 1)).toBe(true);
    expect(flaky.sends.length).toBe(0);

    // Scan 2: same instant → backoff gate blocks retry (no new attempt).
    await runScan(sql, '2026-10-18', { email: flaky, in_app: inApp }, { now: T0 });
    emailRows = await sql`select status, attempts from app.notifications
      where related_case_id = ${kase2} and channel = 'email'`;
    expect(emailRows.every((r) => r.attempts === 1)).toBe(true);
    expect(flaky.sends.length).toBe(0);

    // Scan 3: outage cleared + backoff elapsed → email rows retried and sent.
    outage = false;
    const T1 = new Date(T0.getTime() + 60 * 60_000); // +1h > 15m backoff
    await runScan(sql, '2026-10-18', { email: flaky, in_app: inApp }, { now: T1 });
    emailRows = await sql`select status, attempts from app.notifications
      where related_case_id = ${kase2} and channel = 'email'`;
    expect(emailRows.every((r) => r.status === 'sent')).toBe(true);
    const sentCountAfterRetry = flaky.sends.length;
    expect(sentCountAfterRetry).toBeGreaterThan(0);

    // Scan 4: everything already sent → no re-send (at-most-once for successes).
    const T2 = new Date(T1.getTime() + 60 * 60_000);
    await runScan(sql, '2026-10-18', { email: flaky, in_app: inApp }, { now: T2 });
    expect(flaky.sends.length).toBe(sentCountAfterRetry);
  });
});

describe('in-app persistence for the bell UI', () => {
  it('writes an unread notification row with title/body/link keyed to the recipient', async () => {
    const rows = await sql<{ title: string | null; body: string | null; link: string | null; read_at: string | null; status: string }[]>`
      select title, body, link, to_char(read_at,'YYYY-MM-DD') as read_at, status
      from app.notifications
      where recipient_user_id = ${ids.uEmp} and channel = 'in_app' and related_case_id = ${ids.kase}
      limit 1`;
    expect(rows.length).toBe(1);
    const r = rows[0]!;
    expect(r.status).toBe('sent');
    expect(r.read_at).toBeNull(); // unread
    expect(r.title).toBeTruthy();
    expect(r.body).toBeTruthy();
    expect(r.link).toBe(`/cases/${ids.kase}`);
  });
});
