-- 0001_extensions_and_auth.sql
-- Extensions + a Supabase-compatible auth shim so identical RLS policies run
-- locally (docker pgvector) and on Supabase.
--
-- On Supabase, the `auth` schema, `auth.uid()`, and the `authenticated`/`anon`
-- roles already exist. Locally we create thin equivalents that read the same
-- session GUC (`request.jwt.claim.sub`) Supabase populates from the JWT. RLS
-- tests set that GUC to impersonate a user.

create extension if not exists "pgcrypto";     -- gen_random_uuid(), digest()
create extension if not exists "vector";        -- pgvector for rag_chunks

-- ── auth shim (LOCAL ONLY) ──────────────────────────────────────────────────
-- On real Supabase the `auth` schema and auth.uid()/auth.role() already exist and
-- read the JWT correctly. We must NEVER overwrite them, so create the shim ONLY
-- when the functions are absent (i.e. local docker Postgres). Guarded, not
-- `create or replace`, precisely so applying this to Supabase is a no-op.
create schema if not exists auth;

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    execute $fn$
      create function auth.uid() returns uuid language sql stable as $body$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $body$;
    $fn$;
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'role'
  ) then
    execute $fn$
      create function auth.role() returns text language sql stable as $body$
        select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
      $body$;
    $fn$;
  end if;
end $$;

-- Application schema.
create schema if not exists app;

-- updated_at trigger helper, used by every table.
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = app, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
