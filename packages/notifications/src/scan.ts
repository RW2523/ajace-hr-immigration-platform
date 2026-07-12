/**
 * The deadline scan — PURE core (§9, Appendix B). Given tracked case dates and the
 * versioned notification triggers, it computes which reminders are due at a scan
 * time, with tiered escalation (employee → HR → counsel) and stable dedupe keys
 * so re-scanning never double-sends.
 *
 * Kept pure and clock-injectable so it is testable with a simulated clock. The
 * DB-backed runner (run-scan.ts) resolves recipient roles → users and persists.
 */
import type { NotificationTriggerRow } from '@hr/shared';

const MS_PER_DAY = 86_400_000;
function parse(iso: string): number {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).getTime();
}
export function daysBetween(a: string, b: string): number {
  return Math.round((parse(b) - parse(a)) / MS_PER_DAY);
}
function addDays(iso: string, n: number): string {
  return new Date(parse(iso) + n * MS_PER_DAY).toISOString().slice(0, 10);
}

/** One tracked date on a case. */
export interface TrackedDate {
  caseId: string;
  dateType: string;
  targetDate: string; // ISO
}

export interface DueReminder {
  caseId: string;
  dateType: string;
  targetDate: string;
  offsetDays: number;
  escalationLevel: number;
  recipientRole: 'employee' | 'hr' | 'counsel' | string;
  channels: string[];
  /**
   * Stable idempotency key — one send per (case, date_type, TARGET DATE, offset, level).
   * The target date is part of the key so that when a deadline is corrected or renewed
   * (e.g. an EAD reissued with a new expiry) a fresh reminder series fires, while the
   * SAME date never re-notifies across scans.
   */
  dedupeKey: string;
}

export interface ScanOptions {
  /** Don't fire reminders whose target passed more than this many days ago
   *  (prevents ancient-date backfill spam on first scan). Day-scale deadlines
   *  still escalate as overdue within this window. */
  maxOverdueDays: number;
}

const DEFAULT_OPTS: ScanOptions = { maxOverdueDays: 30 };

export function dedupeKey(
  caseId: string,
  dateType: string,
  targetDate: string,
  offset: number,
  level: number,
): string {
  // Target date is embedded so a changed/renewed date produces a NEW key (new series),
  // while an unchanged date collides and is suppressed (idempotent).
  return `${caseId}:${dateType}:d${targetDate}:o${offset}:l${level}`;
}

/**
 * Compute due reminders at scan time `today`. `alreadySent` holds dedupe keys of
 * reminders already recorded, guaranteeing idempotency across scans.
 */
export function computeDueReminders(
  dates: TrackedDate[],
  triggers: NotificationTriggerRow[],
  today: string,
  alreadySent: ReadonlySet<string> = new Set(),
  options: Partial<ScanOptions> = {},
): DueReminder[] {
  const opts = { ...DEFAULT_OPTS, ...options };
  const byType = new Map(triggers.map((t) => [t.date_type, t]));
  const due: DueReminder[] = [];

  for (const d of dates) {
    const trigger = byType.get(d.dateType);
    if (!trigger) continue;

    const daysUntil = daysBetween(today, d.targetDate); // negative if past
    // Skip dates too far overdue to be actionable.
    if (daysUntil < -opts.maxOverdueDays) continue;

    for (const offset of trigger.default_offsets_days) {
      const fireDate = addDays(d.targetDate, -offset); // reminder becomes due on this date
      if (today < fireDate) continue; // window not open yet

      // Which escalation tiers include this offset?
      for (const tier of trigger.escalation) {
        if (!tier.at_offsets.includes(offset)) continue;
        const key = dedupeKey(d.caseId, d.dateType, d.targetDate, offset, tier.level);
        if (alreadySent.has(key)) continue;
        due.push({
          caseId: d.caseId,
          dateType: d.dateType,
          targetDate: d.targetDate,
          offsetDays: offset,
          escalationLevel: tier.level,
          recipientRole: tier.recipient,
          channels: trigger.channels ?? ['email', 'in_app'],
          dedupeKey: key,
        });
      }
    }
  }

  // Most urgent first (smallest offset), stable for testing.
  due.sort((a, b) => a.offsetDays - b.offsetDays || a.escalationLevel - b.escalationLevel);
  return due;
}
