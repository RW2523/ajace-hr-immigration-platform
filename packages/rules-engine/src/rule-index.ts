/**
 * RuleIndex — resolves the ACTIVE value for a (key, attribute) from versioned
 * rule rows, and carries provenance so callers can surface the §14
 * "as-of / confirmed-by-counsel" indicator. Never hard-codes an immigration value.
 *
 * "Active" = not superseded (`superseded_by is null`) and, among candidates,
 * the one with the latest `effective_date` that is not in the future relative to
 * the evaluation date. This lets a case filed under an old rule be evaluated
 * against the rule in force at its filing date by passing that date as `asOf`.
 */
import type { RuleRow } from '@hr/shared';
import type { ResolvedRule, RuleProvenance } from './types.js';

export class RuleIndex {
  private readonly byKey = new Map<string, RuleRow[]>();

  constructor(rows: RuleRow[]) {
    for (const r of rows) {
      const k = `${r.status_or_transition_key}::${r.attribute}`;
      const list = this.byKey.get(k);
      if (list) list.push(r);
      else this.byKey.set(k, [r]);
    }
  }

  /** Resolve the active rule for (key, attribute) as of `asOf` (ISO date). */
  resolve<T = unknown>(key: string, attribute: string, asOf: string): ResolvedRule<T> | null {
    const rows = this.byKey.get(`${key}::${attribute}`);
    if (!rows || rows.length === 0) return null;

    const candidates = rows
      .filter((r) => r.superseded_by === null)
      .filter((r) => !r.effective_date || r.effective_date <= asOf);

    const pool = candidates.length > 0 ? candidates : rows.filter((r) => r.superseded_by === null);
    if (pool.length === 0) return null;

    // Latest effective_date wins; nulls sort last.
    pool.sort((a, b) => (b.effective_date ?? '0000-00-00').localeCompare(a.effective_date ?? '0000-00-00'));
    const row = pool[0]!;
    return { value: row.value as T, valueType: row.value_type, provenance: provenanceOf(row) };
  }

  /** Convenience: resolve a numeric value or null. */
  number(key: string, attribute: string, asOf: string): { value: number; provenance: RuleProvenance } | null {
    const r = this.resolve(key, attribute, asOf);
    if (r == null) return null;
    const n = typeof r.value === 'number' ? r.value : Number(r.value);
    if (Number.isNaN(n)) return null;
    return { value: n, provenance: r.provenance };
  }

  /** All active attributes for a key (for display / debugging). */
  activeFor(key: string, asOf: string): ResolvedRule[] {
    const out: ResolvedRule[] = [];
    for (const [k, rows] of this.byKey) {
      if (!k.startsWith(`${key}::`)) continue;
      const attribute = k.slice(key.length + 2);
      const r = this.resolve(key, attribute, asOf);
      if (r) out.push(r);
    }
    return out;
  }
}

function provenanceOf(row: RuleRow): RuleProvenance {
  return {
    ruleId: row.rule_id,
    effectiveDate: row.effective_date ?? null,
    confirmedByCounsel: row.confirmed_by_counsel,
    sourceUrl: row.source_url,
    sourceCitation: row.source_citation,
    lastVerified: row.last_verified ?? null,
  };
}
