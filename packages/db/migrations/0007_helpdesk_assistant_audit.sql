-- 0007_helpdesk_assistant_audit.sql
-- Help desk, RAG, notifications, audit (§6.6).

create table app.helpdesk_tickets (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references app.organizations(id) on delete cascade,
  employee_id   uuid references app.employees(id) on delete set null,
  opened_by     uuid references app.users(id),
  subject       text not null,
  body          text not null default '',
  status        text not null default 'open',      -- open | pending | resolved | closed
  assignee_user_id uuid references app.users(id),
  scope         text,                               -- own | assigned | org
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index tickets_org_idx on app.helpdesk_tickets(org_id);
create index tickets_employee_idx on app.helpdesk_tickets(employee_id);
create trigger touch_tickets before update on app.helpdesk_tickets
  for each row execute function app.touch_updated_at();

-- RAG chunks carry ACCESS METADATA so retrieval is scoped server-side (§10).
-- Dimension 1536 (text-embedding-3-small default); change with EMBEDDINGS_DIM.
create table app.rag_chunks (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references app.organizations(id) on delete cascade,
  content       text not null,
  embedding     vector(1536),
  doc_type      text not null,                      -- policy | case_doc | template | faq
  -- access metadata (the retrieval filter):
  owner_user_id uuid references app.users(id) on delete cascade, -- null = org-shared
  owner_employee_id uuid references app.employees(id) on delete cascade,
  role_visibility jsonb not null default '[]'::jsonb, -- e.g. ["employee","hr","employer","admin"]
  source_document_id uuid references app.documents(id) on delete cascade,
  created_at    timestamptz not null default now()
);
create index rag_org_idx on app.rag_chunks(org_id);
create index rag_owner_user_idx on app.rag_chunks(owner_user_id);
-- ANN index for cosine similarity search.
create index rag_embedding_idx on app.rag_chunks
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

create table app.notifications (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references app.organizations(id) on delete cascade,
  recipient_user_id uuid references app.users(id) on delete cascade,
  channel       text not null,                      -- email | in_app | slack | sms
  type          text not null,                      -- date_type from notification_triggers
  related_case_id uuid references app.immigration_cases(id) on delete cascade,
  related_date  date,
  offset_days   int,                                -- which reminder offset fired
  escalation_level int not null default 1,          -- 1 employee, 2 hr, 3 counsel
  status        text not null default 'pending',    -- pending | sent | failed
  sent_at       timestamptz,
  -- idempotency key: prevents duplicate sends on re-scan (§9).
  dedupe_key    text not null,
  created_at    timestamptz not null default now(),
  unique (dedupe_key)
);
create index notifications_recipient_idx on app.notifications(recipient_user_id);
create index notifications_status_idx on app.notifications(status);

-- Append-only audit log (§12). No UPDATE/DELETE policies are ever granted.
create table app.audit_log (
  id            bigint generated always as identity primary key,
  org_id        uuid references app.organizations(id) on delete set null,
  actor_user_id uuid,
  action        text not null,
  resource      text not null,
  matched_permission text,
  before        jsonb,
  after         jsonb,
  context       jsonb,
  created_at    timestamptz not null default now()
);
create index audit_org_idx on app.audit_log(org_id);
create index audit_actor_idx on app.audit_log(actor_user_id);
create index audit_resource_idx on app.audit_log(resource);
