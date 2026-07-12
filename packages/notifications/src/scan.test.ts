import { describe, expect, it } from 'vitest';
import type { NotificationTriggerRow } from '@hr/shared';
import { computeDueReminders, dedupeKey, type TrackedDate } from './scan.js';
import { loadTriggers } from './triggers.js';

const trigger: NotificationTriggerRow = {
  date_type: 'opt_ead_expiry',
  label: 'OPT EAD expiry',
  applies_to_statuses: ['f1_opt'],
  default_offsets_days: [120, 90, 60, 30, 14, 7, 1],
  escalation: [
    { level: 1, recipient: 'employee', at_offsets: [120, 90, 60, 30, 14, 7, 1] },
    { level: 2, recipient: 'hr', at_offsets: [60, 30, 14, 7, 1] },
    { level: 3, recipient: 'counsel', at_offsets: [14, 7, 1] },
  ],
  channels: ['email', 'in_app'],
  spec_ref: 'Appendix B',
};

const target = '2026-12-01';
const dates: TrackedDate[] = [{ caseId: 'case-1', dateType: 'opt_ead_expiry', targetDate: target }];

describe('deadline scan — offset firing (simulated clock)', () => {
  it('fires nothing before the first (120-day) window opens', () => {
    // 121 days before target
    const due = computeDueReminders(dates, [trigger], '2026-08-02');
    expect(due).toHaveLength(0);
  });

  it('fires only the employee tier at exactly 120 days out', () => {
    const due = computeDueReminders(dates, [trigger], '2026-08-03'); // 120 days before
    expect(due).toHaveLength(1);
    expect(due[0]!.offsetDays).toBe(120);
    expect(due[0]!.recipientRole).toBe('employee');
  });

  it('escalates to employee+HR+counsel at 14 days out', () => {
    const due = computeDueReminders(dates, [trigger], '2026-11-17'); // 14 days before
    const at14 = due.filter((d) => d.offsetDays === 14);
    expect(at14.map((d) => d.recipientRole).sort()).toEqual(['counsel', 'employee', 'hr']);
  });
});

describe('idempotency', () => {
  it('does not re-emit reminders already sent', () => {
    const first = computeDueReminders(dates, [trigger], '2026-11-17');
    const sent = new Set(first.map((d) => d.dedupeKey));
    const second = computeDueReminders(dates, [trigger], '2026-11-17', sent);
    expect(second).toHaveLength(0);
  });

  it('dedupe keys are stable and unique per (case,type,date,offset,level)', () => {
    expect(dedupeKey('c', 'opt_ead_expiry', '2026-12-01', 14, 2)).toBe('c:opt_ead_expiry:d2026-12-01:o14:l2');
    const due = computeDueReminders(dates, [trigger], '2026-11-17');
    expect(new Set(due.map((d) => d.dedupeKey)).size).toBe(due.length);
  });

  it('a corrected/renewed date fires a fresh series even when the old keys were sent', () => {
    // Old EAD expiry 2026-12-01, all its 14-day reminders already sent.
    const first = computeDueReminders(dates, [trigger], '2026-11-17');
    const sent = new Set(first.map((d) => d.dedupeKey));
    expect(first.length).toBeGreaterThan(0);

    // EAD renewed: new expiry 2027-02-15. The new target date yields new keys, so
    // reminders fire despite the old series being in `sent`.
    const renewed: TrackedDate[] = [{ caseId: 'case-1', dateType: 'opt_ead_expiry', targetDate: '2027-02-15' }];
    const after = computeDueReminders(renewed, [trigger], '2027-02-01', sent); // 14 days before new date
    const at14 = after.filter((d) => d.offsetDays === 14);
    expect(at14.length).toBe(3); // employee + hr + counsel fire on the new date
    expect(after.every((d) => !sent.has(d.dedupeKey))).toBe(true);
  });
});

describe('catch-up and overdue handling', () => {
  it('fires missed offsets when a scan is skipped (jump past several windows)', () => {
    // Jump straight to 20 days out having sent nothing: 120,90,60,30 windows all crossed.
    const due = computeDueReminders(dates, [trigger], '2026-11-11'); // 20 days before
    const employeeOffsets = due.filter((d) => d.recipientRole === 'employee').map((d) => d.offsetDays).sort((a, b) => b - a);
    expect(employeeOffsets).toEqual([120, 90, 60, 30]);
  });

  it('ignores dates overdue beyond maxOverdueDays', () => {
    const due = computeDueReminders(dates, [trigger], '2027-02-01'); // ~60 days past target
    expect(due).toHaveLength(0);
  });
});

describe('seed triggers load and cover Appendix B', () => {
  it('loads 42 validated triggers including day-scale deadlines', async () => {
    const triggers = await loadTriggers();
    expect(triggers.length).toBeGreaterThanOrEqual(40);
    const types = new Set(triggers.map((t) => t.date_type));
    // Appendix B spot-checks
    for (const t of ['i94_expiry', 'opt_end', 'h1b_validity_expiry', 'i9_section2_deadline', 'rfe_response_deadline', 'passport_expiry']) {
      expect(types.has(t)).toBe(true);
    }
  });
});
