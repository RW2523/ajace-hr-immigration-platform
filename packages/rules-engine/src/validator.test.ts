/**
 * Pure unit tests for the validator over hand-built fixtures (no DB). These pin the
 * Bug 1/2/3/5 fixes: undecidable legal preconditions never auto-pass, timing
 * windows are evaluated from snapshot dates, the clock calculators are wired into
 * findings, and unknown unemployment days are surfaced as unknown (not 0).
 */
import { describe, expect, it } from 'vitest';
import type { RuleRow, StatusRow, TransitionRow, DocumentRequirementRow } from '@hr/shared';
import { validateCase } from './validator.js';
import type { CaseSnapshot, RuleData } from './types.js';

function tx(over: Partial<TransitionRow>): TransitionRow {
  return {
    key: over.key ?? 'k',
    from_status: over.from_status ?? 'a',
    to_status: over.to_status ?? 'b',
    transition_type: over.transition_type ?? 'filing',
    preconditions: over.preconditions ?? [],
    required_documents: over.required_documents ?? [],
    timing_window: over.timing_window ?? {},
    responsible_parties: over.responsible_parties ?? [],
    notification_date_types: over.notification_date_types ?? [],
    edge_branches: over.edge_branches ?? [],
    spec_ref: over.spec_ref ?? '',
  };
}
function rule(over: Partial<RuleRow>): RuleRow {
  return {
    rule_id: over.rule_id ?? 'r',
    status_or_transition_key: over.status_or_transition_key ?? 'k',
    attribute: over.attribute ?? 'a',
    value: over.value ?? 1,
    value_type: over.value_type ?? 'count',
    effective_date: over.effective_date ?? null,
    source_url: over.source_url ?? '',
    source_citation: over.source_citation ?? '',
    confirmed_by_counsel: over.confirmed_by_counsel ?? false,
    superseded_by: over.superseded_by ?? null,
    last_verified: over.last_verified ?? null,
    notes: over.notes ?? '',
  };
}
function data(over: Partial<RuleData>): RuleData {
  return {
    statuses: (over.statuses ?? []) as StatusRow[],
    transitions: over.transitions ?? [],
    rules: over.rules ?? [],
    documentRequirements: (over.documentRequirements ?? []) as DocumentRequirementRow[],
  };
}
function snap(over: Partial<CaseSnapshot>): CaseSnapshot {
  return {
    currentStatus: over.currentStatus ?? 'a',
    dates: over.dates ?? {},
    collectedDocuments: over.collectedDocuments ?? [],
    attributes: over.attributes ?? {},
    ...(over.unemploymentDaysUsed !== undefined ? { unemploymentDaysUsed: over.unemploymentDaysUsed } : {}),
  };
}

describe('Bug 1: undecidable legal preconditions never auto-pass as eligible', () => {
  const d = data({
    transitions: [
      tx({
        key: 'f1_opt__h1b_active',
        from_status: 'f1_opt',
        to_status: 'h1b_active',
        transition_type: 'change_of_status',
        preconditions: [
          { description: 'H-1B petition selected in lottery', rule_ref: 'sel' },
          { description: 'LCA certified', rule_ref: 'lca' },
        ],
        required_documents: [],
      }),
    ],
    rules: [rule({ rule_id: 'sel' }), rule({ rule_id: 'lca' })],
  });

  it('is NOT reported eligible; it lands in needsCounselReview', () => {
    const r = validateCase(d, snap({ currentStatus: 'f1_opt' }), '2026-07-06');
    expect(r.eligibleTransitions.find((t) => t.toStatus === 'h1b_active')).toBeUndefined();
    const rev = r.needsCounselReviewTransitions.find((t) => t.toStatus === 'h1b_active');
    expect(rev).toBeDefined();
    expect(rev!.eligible).toBe(false);
    expect(rev!.needsCounselReview).toBe(true);
    expect(rev!.unconfirmedPreconditions).toEqual([
      'H-1B petition selected in lottery',
      'LCA certified',
    ]);
    // Not double-counted as a hard "ineligible".
    expect(r.ineligibleTransitions.find((t) => t.toStatus === 'h1b_active')).toBeUndefined();
  });

  it('missing documents make it hard-ineligible, not counsel-review', () => {
    const d2 = data({
      transitions: [
        tx({
          key: 'f1_opt__h1b_active',
          from_status: 'f1_opt',
          to_status: 'h1b_active',
          preconditions: [{ description: 'LCA certified', rule_ref: null }],
          required_documents: ['certified_lca'],
        }),
      ],
    });
    const r = validateCase(d2, snap({ currentStatus: 'f1_opt' }), '2026-07-06');
    const rec = r.ineligibleTransitions.find((t) => t.toStatus === 'h1b_active');
    expect(rec).toBeDefined();
    expect(rec!.missingDocuments).toContain('certified_lca');
    expect(r.needsCounselReviewTransitions).toHaveLength(0);
  });

  it('a mechanically confirmable precondition + no missing docs is truly eligible', () => {
    const d3 = data({
      transitions: [
        tx({
          key: 'f1_opt__f1_stem_opt',
          from_status: 'f1_opt',
          to_status: 'f1_stem_opt',
          preconditions: [{ description: 'Employer enrolled in E-Verify', rule_ref: null }],
          required_documents: [],
        }),
      ],
    });
    const r = validateCase(d3, snap({ currentStatus: 'f1_opt', attributes: { employer_everify: true } }), '2026-07-06');
    expect(r.eligibleTransitions.find((t) => t.toStatus === 'f1_stem_opt')?.eligible).toBe(true);
  });

  it('a contradicted mechanical precondition is hard-ineligible', () => {
    const d4 = data({
      transitions: [
        tx({
          key: 'f1_opt__f1_stem_opt',
          from_status: 'f1_opt',
          to_status: 'f1_stem_opt',
          preconditions: [{ description: 'Employer enrolled in E-Verify', rule_ref: null }],
        }),
      ],
    });
    const r = validateCase(d4, snap({ currentStatus: 'f1_opt', attributes: { employer_everify: false } }), '2026-07-06');
    const rec = r.ineligibleTransitions.find((t) => t.toStatus === 'f1_stem_opt');
    expect(rec!.unmetPreconditions.length).toBe(1);
    expect(rec!.needsCounselReview).toBe(false);
  });
});

describe('Bug 5: unknown unemployment days is surfaced as unknown, not 0/limit', () => {
  const d = data({ rules: [rule({ rule_id: 'opt-90', status_or_transition_key: 'f1_opt', attribute: 'unemployment_limit_days', value: 90 })] });

  it('undefined → opt_unemployment_unknown warning (no confident 0/90)', () => {
    const r = validateCase(d, snap({ currentStatus: 'f1_opt' }), '2026-07-06');
    const f = r.findings.find((x) => x.code === 'opt_unemployment_unknown');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('warning');
    expect(r.findings.find((x) => x.code === 'opt_unemployment')).toBeUndefined();
  });

  it('a supplied value → normal opt_unemployment finding', () => {
    const r = validateCase(d, snap({ currentStatus: 'f1_opt', unemploymentDaysUsed: 30 }), '2026-07-06');
    const f = r.findings.find((x) => x.code === 'opt_unemployment');
    expect(f!.message).toContain('30/90');
    expect(r.findings.find((x) => x.code === 'opt_unemployment_unknown')).toBeUndefined();
  });
});

describe('Bugs 2 & 3: timing windows / clocks are evaluated from snapshot dates', () => {
  it('h1b_active with a validity expiry emits an extension-window finding', () => {
    const d = data({ rules: [rule({ rule_id: 'win6', status_or_transition_key: 'h1b_extension_pending', attribute: 'earliest_filing_before_start_months', value: 6 })] });
    const open = validateCase(d, snap({ currentStatus: 'h1b_active', dates: { h1b_validity_expiry: '2026-09-01' } }), '2026-07-06');
    const f = open.findings.find((x) => x.code === 'h1b_extension_window');
    expect(f).toBeDefined();
    expect(f!.message).toContain('OPEN');
    expect(f!.rulesCited).toContain('win6');
    expect(f!.counselPending).toBe(true);

    const expired = validateCase(d, snap({ currentStatus: 'h1b_active', dates: { h1b_validity_expiry: '2026-06-01' } }), '2026-07-06');
    expect(expired.findings.find((x) => x.code === 'h1b_extension_window')!.severity).toBe('violation');
  });

  it('f1_opt with an EAD expiry emits an F-1 grace-period finding', () => {
    const d = data({ rules: [rule({ rule_id: 'grace60', status_or_transition_key: 'f1_opt', attribute: 'grace_period_days_after_program_or_opt', value: 60 })] });
    const r = validateCase(d, snap({ currentStatus: 'f1_opt', dates: { ead_expiry: '2026-06-01' }, unemploymentDaysUsed: 0 }), '2026-07-06');
    const f = r.findings.find((x) => x.code === 'f1_grace_period');
    expect(f).toBeDefined();
    expect(f!.rulesCited).toContain('grace60');
  });

  it('i140_approved past the AC21 one-year deadline with no I-485 → violation', () => {
    const d = data({ rules: [rule({ rule_id: 'bar12', status_or_transition_key: 'i140_approved', attribute: 'post_6yr_106a_failure_to_file_bar_months', value: 12 })] });
    const r = validateCase(d, snap({ currentStatus: 'i140_approved', dates: { priority_date_current: '2025-01-01' } }), '2026-07-06');
    const f = r.findings.find((x) => x.code === 'ac21_one_year_to_file');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('violation');
    expect(f!.rulesCited).toContain('bar12');
  });

  it('i9 deadlines fire from a hire date and cite the seeded i9 rules', () => {
    const d = data({
      rules: [
        rule({ rule_id: 'i9s2', status_or_transition_key: 'all', attribute: 'section2_completion_window_business_days', value: 3, value_type: 'business_days' }),
        rule({ rule_id: 'ev', status_or_transition_key: 'all', attribute: 'case_creation_deadline_business_days', value: 3, value_type: 'business_days' }),
      ],
    });
    const r = validateCase(d, snap({ currentStatus: 'h1b_active', dates: { hire_date: '2026-07-06' } }), '2026-07-06');
    expect(r.findings.find((x) => x.code === 'i9_section2_deadline')?.rulesCited).toContain('i9s2');
    expect(r.findings.find((x) => x.code === 'everify_case_deadline')?.rulesCited).toContain('ev');
  });

  it('no relevant dates → no timing findings emitted', () => {
    const d = data({ rules: [rule({ rule_id: 'win6', status_or_transition_key: 'h1b_extension_pending', attribute: 'earliest_filing_before_start_months', value: 6 })] });
    const r = validateCase(d, snap({ currentStatus: 'h1b_active' }), '2026-07-06');
    expect(r.findings.find((x) => x.code === 'h1b_extension_window')).toBeUndefined();
  });
});
