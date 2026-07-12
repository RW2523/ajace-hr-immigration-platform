-- 0014_employee_secure_ids.sql
-- §12: passport number, SEVIS id, and alien-registration (A-) number are sensitive
-- immigration identifiers. They must NOT sit in the plaintext employees.profile JSONB.
-- Store them app-layer-encrypted (AES-256-GCM envelope) here, mirroring employee_ssn:
-- every read/write goes through the audited, authorized @hr/hr PII service.
create table if not exists app.employee_secure_ids (
  employee_id       uuid primary key references app.employees(id) on delete cascade,
  org_id            uuid not null references app.organizations(id) on delete cascade,
  encrypted_payload text not null,   -- envelope of JSON {passport_number, passport_country, passport_issue, passport_expiry, sevis_number, alien_registration_number}
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'touch_secure_ids') then
    create trigger touch_secure_ids before update on app.employee_secure_ids
      for each row execute function app.touch_updated_at();
  end if;
end $$;

alter table app.employee_secure_ids enable row level security;
drop policy if exists secure_ids_read on app.employee_secure_ids;
create policy secure_ids_read on app.employee_secure_ids for select
  using (app.can_access_employee('sensitive_pii','read', employee_id, org_id));
drop policy if exists secure_ids_write on app.employee_secure_ids;
create policy secure_ids_write on app.employee_secure_ids for all
  using (app.can_access_employee('sensitive_pii','update', employee_id, org_id))
  with check (app.can_access_employee('sensitive_pii','create', employee_id, org_id));
