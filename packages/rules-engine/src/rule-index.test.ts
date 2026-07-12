import { describe, expect, it } from 'vitest';
import type { RuleRow } from '@hr/shared';
import { RuleIndex } from './rule-index.js';

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

describe('RuleIndex as-of historical resolution (Bug 4)', () => {
  // v1 was in force from 2020 and is now superseded by v2 (effective 2024).
  const idx = new RuleIndex([
    rule({ rule_id: 'v1', attribute: 'limit', value: 90, effective_date: '2020-01-01', superseded_by: 'v2' }),
    rule({ rule_id: 'v2', attribute: 'limit', value: 150, effective_date: '2024-01-01', superseded_by: null }),
  ]);

  it('resolves asOf=2021 to v1 (the row actually in force then), NOT dropping it for being superseded', () => {
    const r = idx.resolve('k', 'limit', '2021-06-01')!;
    expect(r.value).toBe(90);
    expect(r.provenance.ruleId).toBe('v1');
  });

  it('resolves asOf=2025 to v2 (the later effective row)', () => {
    const r = idx.resolve('k', 'limit', '2025-06-01')!;
    expect(r.value).toBe(150);
    expect(r.provenance.ruleId).toBe('v2');
  });

  it('never applies a future-dated rule early', () => {
    // As of 2019 nothing is yet effective → null (not v1, which starts 2020).
    expect(idx.resolve('k', 'limit', '2019-06-01')).toBeNull();
    // As of 2023 the 2024 row is still in the future → v1, not v2.
    expect(idx.resolve('k', 'limit', '2023-06-01')!.value).toBe(90);
  });

  it('a null-effective baseline is superseded by any dated row in force', () => {
    const idx2 = new RuleIndex([
      rule({ rule_id: 'base', attribute: 'a', value: 1, effective_date: null }),
      rule({ rule_id: 'dated', attribute: 'a', value: 2, effective_date: '2022-01-01' }),
    ]);
    expect(idx2.resolve('k', 'a', '2021-01-01')!.value).toBe(1); // dated not yet effective
    expect(idx2.resolve('k', 'a', '2023-01-01')!.value).toBe(2); // dated now wins
  });
});
