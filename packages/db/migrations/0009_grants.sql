-- 0009_grants.sql
-- Grants for the non-superuser application role. On Supabase the `authenticated`
-- and `anon` roles already exist with these grants; locally we create an
-- equivalent so RLS is actually exercised (superusers bypass RLS).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    -- service_role bypasses RLS (used by trusted server jobs: ingestion, seed, scans).
    create role service_role nologin bypassrls;
  end if;
end $$;

grant usage on schema app, auth to authenticated, service_role;

-- Table privileges (RLS still constrains rows for `authenticated`).
grant select, insert, update, delete on all tables in schema app to authenticated;
grant usage, select on all sequences in schema app to authenticated;
grant all on all tables in schema app to service_role;
grant usage, select on all sequences in schema app to service_role;

-- Execute the SECURITY DEFINER helpers.
grant execute on all functions in schema app to authenticated, service_role;
grant execute on all functions in schema auth to authenticated, service_role;

-- Future tables inherit the same grants.
alter default privileges in schema app grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema app grant all on tables to service_role;
