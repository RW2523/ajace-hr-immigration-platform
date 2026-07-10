import { describe, expect, it } from 'vitest';
import { i9Retention } from './i9.js';
import { renderTemplate, DEFAULT_OFFER_TEMPLATE } from './offer-letter.js';
import { buildOnboardingChecklist } from './onboarding.js';
import type { DocumentRequirementRow } from '@hr/shared';

describe('I-9 retention rule (A.8): 3y after hire OR 1y after termination, whichever later', () => {
  it('uses 3-years-after-hire when still employed', () => {
    expect(i9Retention('2026-01-15', null)).toBe('2029-01-15');
  });
  it('uses 1-year-after-termination when that is later', () => {
    // hired 2026-01-15 (+3y = 2029), terminated 2028-12-01 (+1y = 2029-12-01) → later
    expect(i9Retention('2026-01-15', '2028-12-01')).toBe('2029-12-01');
  });
  it('uses 3-years-after-hire when termination is early', () => {
    // hired 2026-01-15 (+3y = 2029-01-15), terminated 2026-03-01 (+1y = 2027-03-01) → hire wins
    expect(i9Retention('2026-01-15', '2026-03-01')).toBe('2029-01-15');
  });
});

describe('offer letter templating', () => {
  it('substitutes all variables', () => {
    const text = renderTemplate(DEFAULT_OFFER_TEMPLATE, {
      employee_name: 'Jane Doe',
      role_title: 'Senior Consultant',
      employment_type: 'placement',
      start_date: '2026-08-01',
      compensation: '$150,000/yr',
      work_location: 'Client site, Austin TX',
      employer_name: 'Acme Staffing',
    });
    expect(text).toContain('Jane Doe');
    expect(text).toContain('Senior Consultant');
    expect(text).not.toContain('{{');
  });
  it('throws when a variable is missing', () => {
    expect(() => renderTemplate('Hello {{name}} at {{company}}', { name: 'X' })).toThrow(/company/);
  });
});

describe('adaptive onboarding checklist (§7.3)', () => {
  const reqs: DocumentRequirementRow[] = [
    { key: 'ead_card', label: 'EAD Card', applies_to_statuses: ['f1_opt'], applies_to_transitions: [], required: true, uploader: 'employee', verifier: 'hr', sensitive_pii: true, retention_note: '', notes: '' },
    { key: 'i797', label: 'I-797 Approval', applies_to_statuses: ['h1b_active'], applies_to_transitions: [], required: true, uploader: 'hr', verifier: 'hr', sensitive_pii: false, retention_note: '', notes: '' },
  ];
  it('includes backbone items plus category-specific immigration docs', () => {
    const optList = buildOnboardingChecklist('f1_opt', reqs);
    const keys = optList.map((i) => i.key);
    expect(keys).toContain('i9_section1');
    expect(keys).toContain('doc_ead_card');
    expect(keys).not.toContain('doc_i797'); // that's an H-1B doc
  });
  it('adapts to a different category', () => {
    const h1bList = buildOnboardingChecklist('h1b_active', reqs);
    expect(h1bList.map((i) => i.key)).toContain('doc_i797');
  });
});
