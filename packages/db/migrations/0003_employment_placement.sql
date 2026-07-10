-- 0003_employment_placement.sql
-- Employment & placement (§6.2). Supports both employment types (§2):
-- placement (consultant at a client site) and direct_hire.

create table app.employees (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references app.organizations(id) on delete cascade,
  user_id       uuid unique references app.users(id) on delete set null,
  full_name     text not null,
  work_email    text,
  employment_type text not null check (employment_type in ('placement', 'direct_hire')),
  -- FK to app.statuses(key), added after statuses table exists (0004).
  work_authorization_category text,
  hire_date     date,
  termination_date date,
  manager_employee_id uuid references app.employees(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index employees_org_idx on app.employees(org_id);
create index employees_user_idx on app.employees(user_id);
create trigger touch_employees before update on app.employees
  for each row execute function app.touch_updated_at();

create table app.clients (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references app.organizations(id) on delete cascade,
  name        text not null,
  address     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index clients_org_idx on app.clients(org_id);
create trigger touch_clients before update on app.clients
  for each row execute function app.touch_updated_at();

create table app.vendors (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references app.organizations(id) on delete cascade,
  name        text not null,
  layer       text,   -- 'prime' | 'vendor' | 'implementation_partner'
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index vendors_org_idx on app.vendors(org_id);
create trigger touch_vendors before update on app.vendors
  for each row execute function app.touch_updated_at();

create table app.placements (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references app.organizations(id) on delete cascade,
  employee_id    uuid not null references app.employees(id) on delete cascade,
  client_id      uuid references app.clients(id) on delete set null,
  vendor_id      uuid references app.vendors(id) on delete set null,
  project_name   text,
  start_date     date,
  end_date       date,
  worksite_address text,
  -- Metro area (MSA) is first-class: a change here triggers the H-1B amended
  -- petition workflow (§7.6, §4 Phase 4).
  worksite_metro text,
  is_remote      boolean not null default false,
  -- supporting evidence references (documents live in app.documents)
  status         text not null default 'active',  -- active | ended | pending
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index placements_org_idx on app.placements(org_id);
create index placements_employee_idx on app.placements(employee_id);
create trigger touch_placements before update on app.placements
  for each row execute function app.touch_updated_at();
