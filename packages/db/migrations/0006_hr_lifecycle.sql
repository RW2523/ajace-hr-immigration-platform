-- 0006_hr_lifecycle.sql
-- HR lifecycle modules (§6.5). Sensitive columns (W-4, SSN) hold app-layer
-- ciphertext (bytea/text envelopes from @hr/shared encryption) — never plaintext.

create table app.offer_letters (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references app.organizations(id) on delete cascade,
  employee_id   uuid not null references app.employees(id) on delete cascade,
  template_key  text,
  variables     jsonb not null default '{}'::jsonb,
  generated_document_id uuid references app.documents(id) on delete set null,
  esign_status  text not null default 'draft',   -- draft | sent | signed | declined
  signed_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index offer_letters_employee_idx on app.offer_letters(employee_id);
create trigger touch_offer_letters before update on app.offer_letters
  for each row execute function app.touch_updated_at();

create table app.i9_records (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references app.organizations(id) on delete cascade,
  employee_id   uuid not null references app.employees(id) on delete cascade,
  section1_completed_at timestamptz,
  section2_completed_at timestamptz,
  section2_due  date,                             -- 3 business days from start (rules-derived)
  list_a_doc    text,
  list_b_doc    text,
  list_c_doc    text,
  everify_case_id text,
  everify_due   date,                             -- 3 business days from hire
  alternative_procedure boolean not null default false,
  receipt_rule_expires date,                       -- 90-day receipt rule
  retention_until date,                            -- 3yr-after-hire or 1yr-after-term, later
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index i9_employee_idx on app.i9_records(employee_id);
create trigger touch_i9 before update on app.i9_records
  for each row execute function app.touch_updated_at();

create table app.w4_records (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references app.organizations(id) on delete cascade,
  employee_id   uuid not null references app.employees(id) on delete cascade,
  -- Encrypted W-4 payload (app-layer AES-GCM envelope). Never plaintext.
  encrypted_payload text not null,
  tax_year      int,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index w4_employee_idx on app.w4_records(employee_id);
create trigger touch_w4 before update on app.w4_records
  for each row execute function app.touch_updated_at();

-- Encrypted SSN store, separated from the employees table (need-to-know, audited).
create table app.employee_ssn (
  employee_id   uuid primary key references app.employees(id) on delete cascade,
  org_id        uuid not null references app.organizations(id) on delete cascade,
  encrypted_ssn text not null,                     -- app-layer envelope
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger touch_ssn before update on app.employee_ssn
  for each row execute function app.touch_updated_at();

create table app.policy_acknowledgments (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references app.organizations(id) on delete cascade,
  employee_id   uuid not null references app.employees(id) on delete cascade,
  policy_key    text not null,
  policy_version text not null,
  acknowledged_at timestamptz,
  created_at    timestamptz not null default now()
);
create index policy_ack_employee_idx on app.policy_acknowledgments(employee_id);

create table app.benefits_enrollments (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references app.organizations(id) on delete cascade,
  employee_id   uuid not null references app.employees(id) on delete cascade,
  plan_selections jsonb not null default '{}'::jsonb,
  status        text not null default 'pending',  -- pending | enrolled | waived
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index benefits_employee_idx on app.benefits_enrollments(employee_id);
create trigger touch_benefits before update on app.benefits_enrollments
  for each row execute function app.touch_updated_at();

create table app.leave_requests (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references app.organizations(id) on delete cascade,
  employee_id   uuid not null references app.employees(id) on delete cascade,
  leave_type    text not null,
  start_date    date not null,
  end_date      date not null,
  status        text not null default 'requested', -- requested | approved | denied | cancelled
  approver_user_id uuid references app.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index leave_employee_idx on app.leave_requests(employee_id);
create trigger touch_leave before update on app.leave_requests
  for each row execute function app.touch_updated_at();

create table app.training_records (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references app.organizations(id) on delete cascade,
  employee_id   uuid not null references app.employees(id) on delete cascade,
  course        text not null,
  completed_at  date,
  expires_at    date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index training_employee_idx on app.training_records(employee_id);
create trigger touch_training before update on app.training_records
  for each row execute function app.touch_updated_at();

create table app.performance_reviews (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references app.organizations(id) on delete cascade,
  employee_id   uuid not null references app.employees(id) on delete cascade,
  cycle         text not null,
  self_input    jsonb,
  manager_input jsonb,
  rating        text,
  status        text not null default 'open',      -- open | submitted | signed_off
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index reviews_employee_idx on app.performance_reviews(employee_id);
create trigger touch_reviews before update on app.performance_reviews
  for each row execute function app.touch_updated_at();

create table app.offboarding (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references app.organizations(id) on delete cascade,
  employee_id   uuid not null references app.employees(id) on delete cascade,
  last_day      date,
  checklist     jsonb not null default '[]'::jsonb,
  status        text not null default 'open',      -- open | in_progress | complete
  -- completion triggers the immigration grace-period clock (§8, §7.4).
  grace_clock_started boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index offboarding_employee_idx on app.offboarding(employee_id);
create trigger touch_offboarding before update on app.offboarding
  for each row execute function app.touch_updated_at();
