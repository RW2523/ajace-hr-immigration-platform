/**
 * Scoped data-access helpers for the UI. Each query applies the caller's effective
 * scope (own / assigned / org / global) explicitly — the SAME rule the packages and
 * RLS enforce — so the UI only ever receives permitted rows. RLS is the backstop.
 */
import 'server-only';
import { effectiveScope, type Principal } from '@hr/shared';
import { db } from './session';

export interface EmployeeRow {
  id: string;
  full_name: string;
  employment_type: string;
  work_authorization_category: string | null;
  status: string;
  user_id: string | null;
}

/** Employees visible to the principal, honoring own/assigned/org/global scope. */
export async function scopedEmployees(principal: Principal): Promise<EmployeeRow[]> {
  const sql = db();
  const scope = effectiveScope(principal, 'others_profiles', 'read') ?? effectiveScope(principal, 'own_profile', 'read');
  if (scope === 'global') {
    return sql<EmployeeRow[]>`select id, full_name, employment_type, work_authorization_category, status, user_id from app.employees order by full_name`;
  }
  if (scope === 'org') {
    return sql<EmployeeRow[]>`select id, full_name, employment_type, work_authorization_category, status, user_id from app.employees where org_id = ${principal.orgId} order by full_name`;
  }
  if (scope === 'assigned') {
    return sql<EmployeeRow[]>`
      select id, full_name, employment_type, work_authorization_category, status, user_id from app.employees
      where org_id = ${principal.orgId} and (user_id = ${principal.userId} or id = any(${principal.assignedEmployeeIds}::uuid[]))
      order by full_name`;
  }
  // own
  return sql<EmployeeRow[]>`select id, full_name, employment_type, work_authorization_category, status, user_id from app.employees where user_id = ${principal.userId}`;
}

export interface CaseRow {
  id: string;
  employee_id: string;
  employee_name: string;
  current_status: string;
}

export async function scopedCases(principal: Principal): Promise<CaseRow[]> {
  const ids = (await scopedEmployees(principal)).map((e) => e.id);
  if (ids.length === 0) return [];
  return db()<CaseRow[]>`
    select c.id, c.employee_id, e.full_name as employee_name, c.current_status
    from app.immigration_cases c join app.employees e on e.id = c.employee_id
    where c.employee_id = any(${ids}::uuid[]) order by e.full_name`;
}

export interface DeadlineRow {
  date_type: string;
  value: string;
  case_id: string;
  employee_name: string;
}

export async function scopedUpcomingDeadlines(principal: Principal, withinDays = 180): Promise<DeadlineRow[]> {
  const ids = (await scopedEmployees(principal)).map((e) => e.id);
  if (ids.length === 0) return [];
  return db()<DeadlineRow[]>`
    select d.date_type, to_char(d.value,'YYYY-MM-DD') as value, d.case_id, e.full_name as employee_name
    from app.case_dates d
    join app.immigration_cases c on c.id = d.case_id
    join app.employees e on e.id = c.employee_id
    where c.employee_id = any(${ids}::uuid[])
      and d.value <= (current_date + (${withinDays}::int))
    order by d.value asc limit 50`;
}

export async function pendingI9(principal: Principal): Promise<{ employee_name: string; section2_due: string | null; everify_due: string | null }[]> {
  const ids = (await scopedEmployees(principal)).map((e) => e.id);
  if (ids.length === 0) return [];
  return db()<{ employee_name: string; section2_due: string | null; everify_due: string | null }[]>`
    select e.full_name as employee_name, to_char(i.section2_due,'YYYY-MM-DD') as section2_due, to_char(i.everify_due,'YYYY-MM-DD') as everify_due
    from app.i9_records i join app.employees e on e.id = i.employee_id
    where i.employee_id = any(${ids}::uuid[]) and (i.section2_completed_at is null or i.everify_case_id is null)`;
}

/** The employee record linked to the current user (null for staff without one). */
export async function myEmployee(principal: Principal): Promise<{ id: string; org_id: string; full_name: string; work_authorization_category: string | null } | null> {
  const [e] = await db()<{ id: string; org_id: string; full_name: string; work_authorization_category: string | null }[]>`
    select id, org_id, full_name, work_authorization_category from app.employees where user_id = ${principal.userId}`;
  return e ?? null;
}

/** Employee ids in the caller's scope (own + assigned/org/global). */
export async function scopedEmployeeIds(principal: Principal): Promise<string[]> {
  return (await scopedEmployees(principal)).map((e) => e.id);
}

export async function rulesSummary(): Promise<{ total: number; confirmed: number; pending: number; domains: number }> {
  const [row] = await db()<{ total: number; confirmed: number; pending: number; domains: number }[]>`
    select count(*)::int as total,
           count(*) filter (where confirmed_by_counsel)::int as confirmed,
           count(*) filter (where not confirmed_by_counsel)::int as pending,
           count(distinct domain)::int as domains
    from app.rules where superseded_by is null`;
  return row!;
}
