-- 0016 — Notification delivery hardening + counsel role (Phase 3 production seams).
-- Adds:
--   1. at-least-once retry bookkeeping on app.notifications (attempts / backoff / error)
--   2. in-app "bell" content columns (title / body / link / read_at) so a topbar bell
--      UI can render unread notifications keyed to recipient_user_id
--   3. a first-class `counsel` role so the counsel escalation tier routes to attorneys
--      instead of falling through to the org admin.
-- Fully idempotent: safe to re-run.

-- ── 1 + 2. notifications columns ────────────────────────────────────────────
alter table app.notifications add column if not exists attempts        int not null default 0;
alter table app.notifications add column if not exists next_attempt_at timestamptz;      -- retry not before this instant (null = eligible now)
alter table app.notifications add column if not exists last_error      text;
-- User-facing in-app content (populated for the in_app channel; read by the bell UI).
alter table app.notifications add column if not exists title           text;
alter table app.notifications add column if not exists body            text;
alter table app.notifications add column if not exists link            text;
alter table app.notifications add column if not exists read_at         timestamptz;      -- null = unread

-- Bell UI lookup: unread in-app notifications for a recipient.
create index if not exists notifications_bell_idx
  on app.notifications (recipient_user_id, channel, read_at);

-- ── 3. counsel role ─────────────────────────────────────────────────────────
-- Data, not code: the counsel/attorney tier of the escalation ladder. Ranked just
-- above HR (2) and below Employer (1); read access to case internals / work auth.
insert into app.roles (key, label, description, rank, is_system)
values ('counsel', 'Counsel',
        'Immigration attorney / counsel of record. Receives the escalated (tier 3) deadline reminders; read access to case internals and work authorization for the org.',
        2, true)
on conflict (key) do update set
  label = excluded.label, description = excluded.description;

-- Grant counsel a read-only operational view so escalations are actionable.
do $$
declare
  r_counsel uuid;
  p uuid;
  perm record;
begin
  select id into r_counsel from app.roles where key = 'counsel';
  for perm in
    select * from (values
      ('case_internals','read','org'),
      ('work_authorization','read','org'),
      ('sensitive_pii','read','org'),
      ('documents','read','org'),
      ('others_profiles','read','org')
    ) as t(resource, action, scope)
  loop
    insert into app.permissions (resource, action, scope)
      values (perm.resource, perm.action, perm.scope)
      on conflict (resource, action, scope) do update set resource = excluded.resource
      returning id into p;
    insert into app.role_permissions (role_id, permission_id)
      values (r_counsel, p) on conflict do nothing;
  end loop;
end $$;
