-- 0012_helpdesk_threads.sql
-- Complete the HR help desk: ticket priority/category + a conversation thread so
-- employees and HR/employer can go back and forth on a ticket, with staff-only
-- internal notes. RLS mirrors ticket visibility (a message is visible iff its
-- ticket is visible), and internal notes are hidden from the employee.

alter table app.helpdesk_tickets add column if not exists priority text not null default 'normal';   -- low | normal | high | urgent
alter table app.helpdesk_tickets add column if not exists category text not null default 'general';  -- immigration | payroll | benefits | it | general
alter table app.helpdesk_tickets add column if not exists resolved_at timestamptz;

create table if not exists app.helpdesk_messages (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references app.organizations(id) on delete cascade,
  ticket_id     uuid not null references app.helpdesk_tickets(id) on delete cascade,
  author_user_id uuid references app.users(id) on delete set null,
  body          text not null,
  internal      boolean not null default false,   -- staff-only note, hidden from the employee
  created_at    timestamptz not null default now()
);
create index if not exists helpdesk_messages_ticket_idx on app.helpdesk_messages(ticket_id);

alter table app.helpdesk_messages enable row level security;

-- A message is visible iff its parent ticket is visible (the inner select is
-- itself RLS-filtered), and internal notes require staff-level helpdesk reach.
drop policy if exists helpdesk_messages_read on app.helpdesk_messages;
create policy helpdesk_messages_read on app.helpdesk_messages for select
  using (
    ticket_id in (select id from app.helpdesk_tickets)
    and (not internal or app.max_scope('helpdesk','read') in ('assigned','org','global'))
  );

drop policy if exists helpdesk_messages_write on app.helpdesk_messages;
create policy helpdesk_messages_write on app.helpdesk_messages for insert
  with check (
    author_user_id = auth.uid()
    and ticket_id in (select id from app.helpdesk_tickets)
  );
