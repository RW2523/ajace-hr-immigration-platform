/**
 * Clock calculators for the §7.4 edge cases. Every limit/window is read from the
 * versioned rules (RuleIndex) — never a constant — so a counsel rule change is a
 * data edit. Each result carries the rule ids it used for traceability (§7.5).
 *
 * All date math is calendar-based (UTC, date-only) unless a function is explicitly
 * documented as business-day.
 */
import type { RuleIndex } from './rule-index.js';
import type { RuleProvenance } from './types.js';

const MS_PER_DAY = 86_400_000;

export function parseDate(iso: string): Date {
  // Treat as date-only, UTC midnight, to avoid TZ drift.
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`);
}
export function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function addDays(iso: string, days: number): string {
  return toISO(new Date(parseDate(iso).getTime() + days * MS_PER_DAY));
}
/** Calendar days from `a` to `b` (b - a). Negative if b precedes a. */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / MS_PER_DAY);
}
/** Add N US business days (Mon–Fri), skipping weekends. Federal holidays are not
 *  modeled here — I-9/E-Verify guidance counts "business days"; holiday handling is
 *  a documented refinement point, flagged so it is never silently assumed correct. */
export function addBusinessDays(iso: string, businessDays: number): string {
  let d = parseDate(iso);
  let added = 0;
  while (added < businessDays) {
    d = new Date(d.getTime() + MS_PER_DAY);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return toISO(d);
}

export interface UnemploymentClock {
  status: string;
  limitDays: number;
  usedDays: number;
  remainingDays: number;
  violated: boolean;
  rulesCited: string[];
  counselPending: boolean;
}

/**
 * OPT / STEM unemployment clock (§7.4, A.2/A.3). Counts calendar days of
 * unemployment from EAD start. STEM limit (150) is INCLUSIVE of days used during
 * initial OPT and does not reset. Cap-gap does NOT pause the clock — callers that
 * model cap-gap must still include those days in `usedDays`.
 */
export function unemploymentClock(
  status: string,
  usedDays: number,
  index: RuleIndex,
  asOf: string,
): UnemploymentClock | null {
  // The limit attribute differs by status; both live in the seed as versioned rules.
  const attr = status === 'f1_stem_opt' ? 'unemployment_limit_days_total' : 'unemployment_limit_days';
  const limit = index.number(status, attr, asOf) ?? index.number(status, 'unemployment_limit_days', asOf);
  if (!limit) return null;
  const remaining = limit.value - usedDays;
  return {
    status,
    limitDays: limit.value,
    usedDays,
    remainingDays: remaining,
    violated: remaining < 0,
    rulesCited: [limit.provenance.ruleId],
    counselPending: !limit.provenance.confirmedByCounsel,
  };
}

export interface GracePeriod {
  status: string;
  graceDays: number;
  endsOn: string | null;
  rulesCited: string[];
  counselPending: boolean;
}

/**
 * Grace period after a status ends (§7.4): 60-day H-1B grace on termination;
 * 60-day F-1 grace after OPT. Read from the status's grace rule or the status row.
 */
export function gracePeriod(
  status: string,
  endEventDate: string | null,
  index: RuleIndex,
  asOf: string,
): GracePeriod | null {
  // Try a status-specific grace rule first (e.g. grace_period_days_after_program_or_opt).
  const candidates = ['grace_period_days_after_program_or_opt', 'grace_period_days', 'termination_grace_period_days'];
  for (const attr of candidates) {
    const r = index.number(status, attr, asOf);
    if (r) {
      return {
        status,
        graceDays: r.value,
        endsOn: endEventDate ? addDays(endEventDate, r.value) : null,
        rulesCited: [r.provenance.ruleId],
        counselPending: !r.provenance.confirmedByCounsel,
      };
    }
  }
  return null;
}

export interface Window {
  earliest: string | null;
  latest: string | null;
  openNow: boolean;
  rulesCited: string[];
  counselPending: boolean;
}

/**
 * STEM OPT auto-extension boundary: timely filing extends work authorization up
 * to N days (180) past the OPT EAD expiry while the extension is pending (A.3).
 */
export function stemAutoExtensionBoundary(
  optEadExpiry: string,
  index: RuleIndex,
  asOf: string,
): { boundary: string; days: number; rulesCited: string[]; counselPending: boolean } | null {
  const r =
    index.number('f1_opt__f1_stem_opt', 'automatic_ead_extension_days_while_pending', asOf) ??
    index.number('f1_stem_opt', 'automatic_ead_extension_days_while_pending', asOf);
  if (!r) return null;
  return {
    boundary: addDays(optEadExpiry, r.value),
    days: r.value,
    rulesCited: [r.provenance.ruleId],
    counselPending: !r.provenance.confirmedByCounsel,
  };
}

/**
 * H-1B extension filing window: up to N months (6) before validity expiry; the
 * 240-day rule authorizes work while a timely extension is pending (A.6).
 */
export function h1bExtensionWindow(
  validityExpiry: string,
  index: RuleIndex,
  asOf: string,
): Window | null {
  const months = index.number('h1b_active__h1b_extension_pending', 'extension_filing_window_months_before_expiry', asOf)
    ?? index.number('h1b_active', 'extension_filing_window_months_before_expiry', asOf);
  if (!months) return null;
  const earliest = addDays(validityExpiry, -Math.round(months.value * 30.44));
  return {
    earliest,
    latest: validityExpiry,
    openNow: asOf >= earliest && asOf <= validityExpiry,
    rulesCited: [months.provenance.ruleId],
    counselPending: !months.provenance.confirmedByCounsel,
  };
}

/**
 * AC21 "one year to file I-485" trap (§7.4, A.6): once the priority date has been
 * current for N days (365) without an I-485 filed, further extensions are barred.
 * Returns the deadline and whether it has lapsed.
 */
export function ac21OneYearToFile(
  priorityDateBecameCurrent: string,
  i485Filed: boolean,
  index: RuleIndex,
  asOf: string,
): { deadline: string; lapsed: boolean; rulesCited: string[]; counselPending: boolean } | null {
  const r =
    index.number('i140_approved__h1b_extension_pending', 'ac21_one_year_to_file_i485_days', asOf) ??
    index.number('i140_approved', 'ac21_one_year_to_file_i485_days', asOf);
  const days = r?.value ?? 365; // 365 is INA-level; if seed lacks it, still compute but flag counselPending
  const deadline = addDays(priorityDateBecameCurrent, days);
  return {
    deadline,
    lapsed: !i485Filed && asOf > deadline,
    rulesCited: r ? [r.provenance.ruleId] : [],
    counselPending: r ? !r.provenance.confirmedByCounsel : true,
  };
}

/**
 * I-9 / E-Verify deadlines (§8, A.8). Section 2 within N business days of start;
 * E-Verify case within N business days of hire. Values read from rules_i9_everify
 * (keyed under the "all" sentinel status).
 */
export function i9Deadlines(
  hireDate: string,
  index: RuleIndex,
  asOf: string,
): { section2Due: string; everifyDue: string; rulesCited: string[]; counselPending: boolean } | null {
  const s2 =
    index.number('all', 'i9_section2_business_days', asOf) ??
    index.number('all', 'i9_section2_deadline_business_days', asOf);
  const ev =
    index.number('all', 'everify_case_business_days', asOf) ??
    index.number('all', 'everify_case_creation_business_days', asOf);
  if (!s2 && !ev) return null;
  const s2days = s2?.value ?? 3;
  const evdays = ev?.value ?? 3;
  const cited = [s2?.provenance.ruleId, ev?.provenance.ruleId].filter(Boolean) as string[];
  return {
    section2Due: addBusinessDays(hireDate, s2days),
    everifyDue: addBusinessDays(hireDate, evdays),
    rulesCited: cited,
    counselPending: (s2 ? !s2.provenance.confirmedByCounsel : true) || (ev ? !ev.provenance.confirmedByCounsel : true),
  };
}

export type { RuleProvenance };
