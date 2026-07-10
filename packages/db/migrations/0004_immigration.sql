-- 0004_immigration.sql
-- Immigration domain (§6.3). The status taxonomy and state machine are DATA
-- (statuses / transitions), and immigration constants are VERSIONED rows in
-- `rules` (§7.5) — never hard-coded. `confirmed_by_counsel` gates user-facing use.

-- ── status taxonomy (states) — seeded from data/immigration-seed/statuses.json
create table app.statuses (
  key           text primary key,             -- us_citizen | f1_opt | h1b_active | ...
  label         text not null,
  track         text not null,                -- none | f1 | h1b | gc_overlay | other
  sponsorship_required boolean not null default false,
  work_authorized boolean not null default false,
  work_authorization_evidence jsonb not null default '[]'::jsonb,
  is_overlay    boolean not null default false,
  placeholder   boolean not null default false,
  grace_period_days int,
  notes         text not null default '',
  created_at    timestamptz not null default now()
);

-- employees.work_authorization_category references a status key.
alter table app.employees
  add constraint employees_wac_fk
  foreign key (work_authorization_category) references app.statuses(key);

-- ── transitions (edges) — seeded from transitions.json ──────────────────────
create table app.transitions (
  key             text primary key,           -- e.g. f1_opt__f1_stem_opt
  from_status     text not null references app.statuses(key),
  to_status       text not null references app.statuses(key),
  transition_type text not null,
  preconditions   jsonb not null default '[]'::jsonb,
  required_documents jsonb not null default '[]'::jsonb,
  timing_window   jsonb not null default '{}'::jsonb,
  responsible_parties jsonb not null default '[]'::jsonb,
  notification_date_types jsonb not null default '[]'::jsonb,
  edge_branches   jsonb not null default '[]'::jsonb,
  spec_ref        text not null default '',
  created_at      timestamptz not null default now()
);

-- ── versioned rules (§7.5) — seeded from rules_*.json / uscis_fees.json ─────
-- A law/fee change is a NEW row; superseded_by chains the history. The rules
-- engine reads these; nothing here is a code constant.
create table app.rules (
  id            uuid primary key default gen_random_uuid(),
  rule_id       text not null,                 -- stable natural key (idempotent load)
  status_or_transition_key text not null,
  attribute     text not null,
  value         jsonb,                          -- typed by value_type
  value_type    text not null,
  effective_date date,
  source_url    text not null default '',
  source_citation text not null default '',
  confirmed_by_counsel boolean not null default false,
  confirmed_by  uuid references app.users(id),
  confirmed_at  timestamptz,
  superseded_by text,                            -- rule_id of the row that replaces this
  last_verified date,
  notes         text not null default '',
  domain        text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (rule_id)
);
create index rules_key_idx on app.rules(status_or_transition_key);
create index rules_active_idx on app.rules(status_or_transition_key, attribute)
  where superseded_by is null;
create trigger touch_rules before update on app.rules
  for each row execute function app.touch_updated_at();

-- ── immigration cases (one per employee-track) ──────────────────────────────
create table app.immigration_cases (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references app.organizations(id) on delete cascade,
  employee_id     uuid not null references app.employees(id) on delete cascade,
  current_status  text not null references app.statuses(key),
  country_of_birth text,                         -- priority-date/backlog logic
  attorney_of_record text,
  opened_at       timestamptz not null default now(),
  closed_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index cases_org_idx on app.immigration_cases(org_id);
create index cases_employee_idx on app.immigration_cases(employee_id);
create trigger touch_cases before update on app.immigration_cases
  for each row execute function app.touch_updated_at();

-- ── case transitions (history) ──────────────────────────────────────────────
create table app.case_transitions (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references app.organizations(id) on delete cascade,
  case_id        uuid not null references app.immigration_cases(id) on delete cascade,
  from_status    text references app.statuses(key),
  to_status      text not null references app.statuses(key),
  transition_key text references app.transitions(key),
  transition_type text,
  initiated_by   uuid references app.users(id),
  filed_on       date,
  receipt_number text,
  decision       text,                            -- approved | denied | rfe | withdrawn | pending
  decision_date  date,
  notes          text not null default '',
  created_at     timestamptz not null default now()
);
create index case_transitions_case_idx on app.case_transitions(case_id);

-- ── case dates (every tracked date — the notification engine's sole input) ──
create table app.case_dates (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references app.organizations(id) on delete cascade,
  case_id      uuid not null references app.immigration_cases(id) on delete cascade,
  date_type    text not null,                     -- matches notification_triggers.date_type
  value        date not null,
  source       text,                              -- document / manual / derived
  notes        text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index case_dates_case_idx on app.case_dates(case_id);
create index case_dates_type_value_idx on app.case_dates(date_type, value);
create trigger touch_case_dates before update on app.case_dates
  for each row execute function app.touch_updated_at();

-- ── priority date tracking ──────────────────────────────────────────────────
create table app.priority_date_tracking (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references app.organizations(id) on delete cascade,
  case_id        uuid not null references app.immigration_cases(id) on delete cascade,
  priority_date  date,
  preference_category text,                       -- EB-1 | EB-2 | EB-3 | ...
  country        text,
  latest_bulletin_position text,                  -- e.g. 'current' | '2022-11-01'
  chart_in_use   text,                            -- final_action_dates | dates_for_filing
  is_current     boolean not null default false,
  became_current_on date,                          -- starts AC21 one-year clock
  updated_at     timestamptz not null default now(),
  created_at     timestamptz not null default now()
);
create index pdt_case_idx on app.priority_date_tracking(case_id);
create trigger touch_pdt before update on app.priority_date_tracking
  for each row execute function app.touch_updated_at();
