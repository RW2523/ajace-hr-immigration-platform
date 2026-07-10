-- 0005_documents.sql
-- Documents (§6.4). Access-controlled; signed time-limited URLs only (§12).
-- The storage_key points at a private Supabase Storage object; the DB never
-- stores file bytes or public URLs.

create table app.document_requirements (
  key           text primary key,               -- ead_card | form_i983 | client_letter | ...
  label         text not null,
  applies_to_statuses jsonb not null default '[]'::jsonb,
  applies_to_transitions jsonb not null default '[]'::jsonb,
  required      boolean not null default true,
  uploader      text not null default 'employee',
  verifier      text not null default 'hr',
  sensitive_pii boolean not null default false,
  retention_note text not null default '',
  notes         text not null default '',
  created_at    timestamptz not null default now()
);

create table app.documents (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references app.organizations(id) on delete cascade,
  employee_id   uuid references app.employees(id) on delete cascade,
  case_id       uuid references app.immigration_cases(id) on delete cascade,
  document_type text not null,                    -- references document_requirements.key
  storage_key   text not null,                    -- private storage object key
  version       int not null default 1,
  filename      text,
  content_type  text,
  sensitive_pii boolean not null default false,
  uploaded_by   uuid references app.users(id),
  -- retention: computed and enforced by the retention job (§12).
  retention_until date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index documents_org_idx on app.documents(org_id);
create index documents_employee_idx on app.documents(employee_id);
create index documents_case_idx on app.documents(case_id);
create trigger touch_documents before update on app.documents
  for each row execute function app.touch_updated_at();
