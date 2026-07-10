/**
 * Phase 4 integration: staffing amendment workflow, case advancement, and the
 * offboarding grace clock, against the seeded DB.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serviceClient } from '@hr/db';
import { CaseEngine, OffboardingWorkflow, PlacementCompliance, requiresAmendment } from './index.js';

const sql = serviceClient();
const engine = new CaseEngine(sql);
const placement = new PlacementCompliance(sql);
const offboarding = new OffboardingWorkflow(sql);

const ids = {
  org: crypto.randomUUID(),
  uEmp: crypto.randomUUID(),
  emp: crypto.randomUUID(),
  client: crypto.randomUUID(),
  place: crypto.randomUUID(),
  kase: crypto.randomUUID(),
  ob: crypto.randomUUID(),
};

beforeAll(async () => {
  await sql`delete from app.users where email like '%@wf.test'`;
  await sql`delete from app.organizations where name = 'WF Org'`;
  await sql`insert into app.organizations (id, name) values (${ids.org}, 'WF Org')`;
  await sql`insert into app.users (id, org_id, email, full_name) values (${ids.uEmp}, ${ids.org}, 'emp@wf.test', 'Emp')`;
  await sql`insert into app.employees (id, org_id, user_id, full_name, employment_type)
    values (${ids.emp}, ${ids.org}, ${ids.uEmp}, 'Emp', 'placement')`;
  await sql`insert into app.clients (id, org_id, name) values (${ids.client}, ${ids.org}, 'BigCo')`;
  await sql`insert into app.placements (id, org_id, employee_id, client_id, worksite_metro)
    values (${ids.place}, ${ids.org}, ${ids.emp}, ${ids.client}, 'New York-Newark-Jersey City, NY-NJ-PA')`;
  await sql`insert into app.immigration_cases (id, org_id, employee_id, current_status)
    values (${ids.kase}, ${ids.org}, ${ids.emp}, 'h1b_active')`;
  await sql`insert into app.offboarding (id, org_id, employee_id) values (${ids.ob}, ${ids.org}, ${ids.emp})`;
});

afterAll(async () => {
  await sql`delete from app.case_dates where org_id = ${ids.org}`;
  await sql`delete from app.case_transitions where org_id = ${ids.org}`;
  await sql`delete from app.immigration_cases where org_id = ${ids.org}`;
  await sql`delete from app.placements where org_id = ${ids.org}`;
  await sql`delete from app.users where org_id = ${ids.org}`;
  await sql`delete from app.organizations where id = ${ids.org}`;
  await sql.end();
});

describe('metro-change amendment rule (§7.6, Simeio)', () => {
  it('same metro → no amendment; different metro on H-1B → amendment', () => {
    expect(requiresAmendment('Austin, TX', 'Austin, TX', 'h1b_active')).toBe(false);
    expect(requiresAmendment('Austin, TX', 'Dallas, TX', 'h1b_active')).toBe(true);
    // first assignment (no prior metro) → covered by original petition
    expect(requiresAmendment(null, 'Dallas, TX', 'h1b_active')).toBe(false);
    // non-H-1B status → no amendment obligation
    expect(requiresAmendment('Austin, TX', 'Dallas, TX', 'f1_opt')).toBe(false);
  });
});

describe('worksite metro change opens the amendment workflow', () => {
  it('a cross-metro move records an amendment transition + tracked date', async () => {
    const change = await placement.changeWorksiteMetro(ids.place, 'San Francisco-Oakland-Berkeley, CA', '2026-08-15');
    expect(change.requiresAmendment).toBe(true);

    const [tr] = await sql`select to_status, transition_type from app.case_transitions
      where case_id = ${ids.kase} and transition_type = 'amendment'`;
    expect(tr!.to_status).toBe('h1b_amendment_pending');

    const [d] = await sql`select date_type, to_char(value,'YYYY-MM-DD') as value from app.case_dates
      where case_id = ${ids.kase} and date_type = 'h1b_amendment_filing_due'`;
    expect(d!.value).toBe('2026-08-15');
  });
});

describe('offboarding starts the H-1B grace clock (§8, §7.4)', () => {
  it('completing offboarding writes an h1b_grace_period_end tracked date', async () => {
    const result = await offboarding.complete(ids.ob, '2026-09-01');
    expect(result.graceStatus).toBe('h1b_active');
    expect(result.graceDays).toBeGreaterThan(0);
    const [d] = await sql`select to_char(value,'YYYY-MM-DD') as value from app.case_dates
      where case_id = ${ids.kase} and date_type = 'h1b_grace_period_end'`;
    expect(d!.value).toBe(result.graceEndsOn);
  });

  it('marks the employee terminated', async () => {
    const [e] = await sql`select status, to_char(termination_date,'YYYY-MM-DD') as td from app.employees where id = ${ids.emp}`;
    expect(e!.status).toBe('offboarded');
    expect(e!.td).toBe('2026-09-01');
  });
});

describe('case advancement validates against rules', () => {
  it('blocks an ineligible transition and allows a forced correction', async () => {
    // h1b_amendment_pending is now the status (set above). Try an obviously invalid jump.
    await sql`update app.immigration_cases set current_status = 'h1b_active' where id = ${ids.kase}`;
    const blocked = await engine.advance({ caseId: ids.kase, toStatus: 'permanent_resident' }, '2026-07-06');
    expect(blocked.ok).toBe(false);
    expect(blocked.blockedReasons?.length).toBeGreaterThan(0);

    const forced = await engine.advance({ caseId: ids.kase, toStatus: 'perm_filed', force: true, filedOn: '2026-07-06' }, '2026-07-06');
    expect(forced.ok).toBe(true);
    const [c] = await sql`select current_status from app.immigration_cases where id = ${ids.kase}`;
    expect(c!.current_status).toBe('perm_filed');
  });
});
