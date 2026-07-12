import { describe, expect, it } from 'vitest';
import type { RuleRow } from '@hr/shared';
import { RuleIndex } from './rule-index.js';
import {
  addBusinessDays,
  addDays,
  addMonths,
  ac21OneYearToFile,
  daysBetween,
  gracePeriod,
  h1bExtensionWindow,
  i9Deadlines,
  stemAutoExtensionBoundary,
  unemploymentClock,
} from './clocks.js';

function rule(over: Partial<RuleRow>): RuleRow {
  return {
    rule_id: over.rule_id ?? 'r',
    status_or_transition_key: over.status_or_transition_key ?? 'f1_opt',
    attribute: over.attribute ?? 'unemployment_limit_days',
    value: over.value ?? 90,
    value_type: over.value_type ?? 'count_days',
    effective_date: over.effective_date ?? '2008-04-08',
    source_url: over.source_url ?? '',
    source_citation: over.source_citation ?? '',
    confirmed_by_counsel: over.confirmed_by_counsel ?? false,
    superseded_by: over.superseded_by ?? null,
    last_verified: over.last_verified ?? '2026-07-06',
    notes: over.notes ?? '',
  };
}

describe('date math', () => {
  it('addDays / daysBetween are inverse', () => {
    expect(addDays('2026-01-01', 30)).toBe('2026-01-31');
    expect(daysBetween('2026-01-01', '2026-01-31')).toBe(30);
    expect(daysBetween('2026-03-01', '2026-02-28')).toBe(-1);
  });

  it('addBusinessDays skips weekends', () => {
    // 2026-07-06 is a Monday. +3 business days = Thursday 2026-07-09.
    expect(addBusinessDays('2026-07-06', 3)).toBe('2026-07-09');
    // Friday +1 business day = Monday.
    expect(addBusinessDays('2026-07-10', 1)).toBe('2026-07-13');
  });
});

describe('OPT unemployment clock (§7.4 / A.2)', () => {
  const idx = new RuleIndex([rule({ rule_id: 'opt-90', value: 90 })]);

  it('is fine at 89 days, at the limit at 90, violated at 91', () => {
    expect(unemploymentClock('f1_opt', 89, idx, '2026-07-06')!.violated).toBe(false);
    expect(unemploymentClock('f1_opt', 90, idx, '2026-07-06')!.violated).toBe(false);
    const over = unemploymentClock('f1_opt', 91, idx, '2026-07-06')!;
    expect(over.violated).toBe(true);
    expect(over.remainingDays).toBe(-1);
  });

  it('reports the rule id and counsel-pending flag', () => {
    const c = unemploymentClock('f1_opt', 10, idx, '2026-07-06')!;
    expect(c.rulesCited).toEqual(['opt-90']);
    expect(c.counselPending).toBe(true); // seed is unratified
  });
});

describe('STEM unemployment clock is 150 inclusive (A.3)', () => {
  const idx = new RuleIndex([
    rule({ rule_id: 'stem-150', status_or_transition_key: 'f1_stem_opt', attribute: 'unemployment_limit_days_total', value: 150 }),
  ]);
  it('uses the STEM total (150), not the OPT 90', () => {
    const c = unemploymentClock('f1_stem_opt', 149, idx, '2026-07-06')!;
    expect(c.limitDays).toBe(150);
    expect(c.violated).toBe(false);
    expect(unemploymentClock('f1_stem_opt', 151, idx, '2026-07-06')!.violated).toBe(true);
  });
});

describe('grace period (§7.4)', () => {
  it('adds the F-1 60-day grace after OPT EAD expiry', () => {
    const idx = new RuleIndex([
      rule({ rule_id: 'grace-60', attribute: 'grace_period_days_after_program_or_opt', value: 60 }),
    ]);
    const g = gracePeriod('f1_opt', '2026-06-01', idx, '2026-07-06')!;
    expect(g.graceDays).toBe(60);
    expect(g.endsOn).toBe(addDays('2026-06-01', 60));
  });
});

describe('STEM auto-extension boundary (A.3, 180 days)', () => {
  it('computes OPT EAD expiry + 180', () => {
    const idx = new RuleIndex([
      rule({ rule_id: 'stem-180', status_or_transition_key: 'f1_opt__f1_stem_opt', attribute: 'automatic_ead_extension_days_while_pending', value: 180 }),
    ]);
    const b = stemAutoExtensionBoundary('2026-06-01', idx, '2026-07-06')!;
    expect(b.days).toBe(180);
    expect(b.boundary).toBe(addDays('2026-06-01', 180));
  });
});

describe('AC21 one-year-to-file trap (§7.4 / A.6)', () => {
  const idx = new RuleIndex([]); // rule absent → falls back to 365 and flags counselPending
  it('flags a lapse when PD current > 1yr and no I-485 filed', () => {
    const r = ac21OneYearToFile('2025-01-01', false, idx, '2026-07-06')!;
    expect(r.deadline).toBe(addDays('2025-01-01', 365));
    expect(r.lapsed).toBe(true);
    expect(r.counselPending).toBe(true);
  });
  it('does not lapse if I-485 was filed', () => {
    expect(ac21OneYearToFile('2025-01-01', true, idx, '2026-07-06')!.lapsed).toBe(false);
  });
});

describe('addMonths (calendar month math with clamping)', () => {
  it('adds and subtracts whole months', () => {
    expect(addMonths('2026-09-01', -6)).toBe('2026-03-01');
    expect(addMonths('2026-01-15', 1)).toBe('2026-02-15');
  });
  it('clamps to the last day of a shorter target month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  });
});

describe('H-1B extension window reads the seeded 6-month rule (A.6)', () => {
  const idx = new RuleIndex([
    rule({ rule_id: 'win6', status_or_transition_key: 'h1b_extension_pending', attribute: 'earliest_filing_before_start_months', value: 6 }),
  ]);
  it('opens 6 months before validity expiry and closes at expiry', () => {
    const w = h1bExtensionWindow('2026-09-01', idx, '2026-07-06')!;
    expect(w.earliest).toBe('2026-03-01');
    expect(w.latest).toBe('2026-09-01');
    expect(w.openNow).toBe(true);
    expect(w.rulesCited).toEqual(['win6']);
    expect(w.counselPending).toBe(true);
  });
  it('is not open before the window and not open after expiry', () => {
    expect(h1bExtensionWindow('2026-09-01', idx, '2026-01-01')!.openNow).toBe(false);
    expect(h1bExtensionWindow('2026-09-01', idx, '2026-10-01')!.openNow).toBe(false);
  });
});

describe('AC21 one-year trap reads the seeded months rule (A.6)', () => {
  const idx = new RuleIndex([
    rule({ rule_id: 'bar12', status_or_transition_key: 'i140_approved', attribute: 'post_6yr_106a_failure_to_file_bar_months', value: 12 }),
  ]);
  it('uses 12 months from priority-date-current and flags a lapse', () => {
    const r = ac21OneYearToFile('2025-01-01', false, idx, '2026-07-06')!;
    expect(r.deadline).toBe('2026-01-01');
    expect(r.lapsed).toBe(true);
    expect(r.rulesCited).toEqual(['bar12']);
    expect(r.counselPending).toBe(true);
  });
});

describe('H-1B 60-day termination grace reads the seeded rule (§7.4)', () => {
  const idx = new RuleIndex([
    rule({ rule_id: 'h1b-grace', status_or_transition_key: 'h1b_active', attribute: 'post_employment_grace_period_days', value: 60 }),
  ]);
  it('computes last day + 60', () => {
    const g = gracePeriod('h1b_active', '2026-09-01', idx, '2026-09-10')!;
    expect(g.graceDays).toBe(60);
    expect(g.endsOn).toBe(addDays('2026-09-01', 60));
    expect(g.rulesCited).toEqual(['h1b-grace']);
  });
});

describe('I-9 / E-Verify deadlines read the seeded business-day rules (A.8)', () => {
  const idx = new RuleIndex([
    rule({ rule_id: 'i9s2', status_or_transition_key: 'all', attribute: 'section2_completion_window_business_days', value: 3, value_type: 'business_days' }),
    rule({ rule_id: 'ev', status_or_transition_key: 'all', attribute: 'case_creation_deadline_business_days', value: 3, value_type: 'business_days' }),
  ]);
  it('computes section-2 and E-Verify due dates in business days', () => {
    // 2026-07-06 is a Monday; +3 business days = Thursday 2026-07-09.
    const d = i9Deadlines('2026-07-06', idx, '2026-07-06')!;
    expect(d.section2Due).toBe('2026-07-09');
    expect(d.everifyDue).toBe('2026-07-09');
    expect(d.rulesCited).toEqual(expect.arrayContaining(['i9s2', 'ev']));
    expect(d.counselPending).toBe(true);
  });
});

describe('RuleIndex versioning (§7.5)', () => {
  it('ignores superseded rows and picks the latest effective value', () => {
    const idx = new RuleIndex([
      rule({ rule_id: 'capgap-old', status_or_transition_key: 'f1_opt__h1b_cap_gap', attribute: 'cap_gap_end_month', value: 'october', effective_date: '2016-01-01', superseded_by: 'capgap-new' }),
      rule({ rule_id: 'capgap-new', status_or_transition_key: 'f1_opt__h1b_cap_gap', attribute: 'cap_gap_end_month', value: 'april', effective_date: '2025-01-17' }),
    ]);
    // As of today, the active (non-superseded) value is April.
    expect(idx.resolve('f1_opt__h1b_cap_gap', 'cap_gap_end_month', '2026-07-06')!.value).toBe('april');
  });

  it('resolves as-of an earlier date to the rule in force then', () => {
    const idx = new RuleIndex([
      rule({ rule_id: 'fee-old', status_or_transition_key: 'h1b_cap', attribute: 'premium_fee', value: 2805, effective_date: '2024-02-26' }),
      rule({ rule_id: 'fee-new', status_or_transition_key: 'h1b_cap', attribute: 'premium_fee', value: 2965, effective_date: '2026-03-01' }),
    ]);
    expect(idx.number('h1b_cap', 'premium_fee', '2025-06-01')!.value).toBe(2805);
    expect(idx.number('h1b_cap', 'premium_fee', '2026-07-06')!.value).toBe(2965);
  });
});
