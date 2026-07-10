-- 0010_employee_status.sql
-- Employment status on the employee record, set to 'offboarded' when offboarding
-- completes (§8). Distinct from users.status (account state).
alter table app.employees
  add column if not exists status text not null default 'active';
  -- active | on_leave | offboarded
