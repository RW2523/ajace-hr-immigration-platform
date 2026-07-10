/**
 * Third-party placement compliance (§7.6) — the staffing-critical workflow.
 *
 * When a consultant on H-1B has a placement whose worksite changes METRO AREA
 * (MSA / area of intended employment, per Matter of Simeio Solutions), an amended
 * H-1B petition is required BEFORE the change. This module detects that condition
 * and opens the amendment workflow: it records the amendment transition intent and
 * a tracked date so the notification engine escalates it.
 *
 * Moves WITHIN the same metro do not require an amendment (LCA posting still
 * applies, handled elsewhere).
 */
import type postgres from 'postgres';

export interface MetroChange {
  placementId: string;
  employeeId: string;
  fromMetro: string | null;
  toMetro: string;
  requiresAmendment: boolean;
}

/** True if a worksite metro change requires an amended H-1B petition. */
export function requiresAmendment(fromMetro: string | null, toMetro: string, status: string): boolean {
  // Only H-1B-class statuses carry the amended-petition obligation.
  const h1bStatuses = new Set(['h1b_active', 'h1b_extension_pending', 'h1b_transfer_pending']);
  if (!h1bStatuses.has(status)) return false;
  if (!fromMetro) return false; // first assignment: covered by the original/initial petition
  return normalizeMetro(fromMetro) !== normalizeMetro(toMetro);
}

function normalizeMetro(m: string): string {
  return m.trim().toLowerCase().replace(/\s+/g, ' ');
}

export class PlacementCompliance {
  constructor(private sql: postgres.Sql) {}

  /**
   * Apply a worksite metro change to a placement. If it requires an amendment,
   * open the amendment workflow (record intent + tracked date) and return the change.
   */
  async changeWorksiteMetro(
    placementId: string,
    toMetro: string,
    effectiveDate: string,
  ): Promise<MetroChange> {
    const [p] = await this.sql<{ org_id: string; employee_id: string; worksite_metro: string | null }[]>`
      select org_id, employee_id, worksite_metro from app.placements where id = ${placementId}`;
    if (!p) throw new Error('placement not found');

    // Determine the employee's current immigration status.
    const [c] = await this.sql<{ id: string; current_status: string }[]>`
      select id, current_status from app.immigration_cases where employee_id = ${p.employee_id}
      order by opened_at desc limit 1`;
    const status = c?.current_status ?? 'unknown';
    const needs = requiresAmendment(p.worksite_metro, toMetro, status);

    await this.sql.begin(async (tx) => {
      await tx`update app.placements set worksite_metro = ${toMetro}, updated_at = now() where id = ${placementId}`;
      if (needs && c) {
        // Record the amendment intent as a pending transition and a tracked date so
        // the deadline engine escalates it (§9). The amendment must be filed at/before
        // the change — the tracked date is the effective date of the worksite change.
        await tx`insert into app.case_transitions (org_id, case_id, from_status, to_status,
                   transition_key, transition_type, notes)
                 values (${p.org_id}, ${c.id}, ${status}, 'h1b_amendment_pending',
                   'h1b_active__h1b_amendment_pending', 'amendment', ${'worksite metro change ' + (p.worksite_metro ?? '(none)') + ' → ' + toMetro})`;
        await tx`insert into app.case_dates (org_id, case_id, date_type, value, source, notes)
                 values (${p.org_id}, ${c.id}, 'h1b_amendment_filing_due', ${effectiveDate}, 'workflow',
                   'Amended H-1B petition required before worksite metro change (Simeio)')`;
      }
    });

    return {
      placementId,
      employeeId: p.employee_id,
      fromMetro: p.worksite_metro,
      toMetro,
      requiresAmendment: needs,
    };
  }
}
