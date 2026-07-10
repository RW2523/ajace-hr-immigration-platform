-- 0002_identity_org.sql
-- Identity, organizations, and the DATA-DRIVEN role/permission model (§3.4, §6.1).
-- Roles and permissions are rows, not enums: adding Immigration Coordinator /
-- Attorney / Paralegal later is an INSERT, not a code change.

-- ── organizations (multi-tenant boundary) ──────────────────────────────────
create table app.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  status      text not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger touch_organizations before update on app.organizations
  for each row execute function app.touch_updated_at();

-- ── users (links to Supabase Auth: users.id == auth.users.id) ───────────────
create table app.users (
  id          uuid primary key,               -- equals auth.users.id
  org_id      uuid not null references app.organizations(id) on delete restrict,
  email       text not null unique,
  full_name   text not null default '',
  status      text not null default 'active',  -- active | suspended | offboarded
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index users_org_idx on app.users(org_id);
create trigger touch_users before update on app.users
  for each row execute function app.touch_updated_at();

-- ── roles (data-driven) ─────────────────────────────────────────────────────
create table app.roles (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,            -- admin | employer | hr | employee | ...
  label       text not null,
  description text not null default '',
  rank        int  not null default 100,        -- lower = higher privilege
  is_system   boolean not null default false,   -- system roles cannot be deleted
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger touch_roles before update on app.roles
  for each row execute function app.touch_updated_at();

-- ── permissions (fine-grained grants) ───────────────────────────────────────
create table app.permissions (
  id          uuid primary key default gen_random_uuid(),
  resource    text not null,   -- see shared/permissions RESOURCES
  action      text not null,   -- read | create | update | delete | manage
  scope       text not null,   -- own | assigned | org | global
  created_at  timestamptz not null default now(),
  unique (resource, action, scope)
);

-- ── role ↔ permission ───────────────────────────────────────────────────────
create table app.role_permissions (
  role_id       uuid not null references app.roles(id) on delete cascade,
  permission_id uuid not null references app.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

-- ── user ↔ role, optionally scoped (org / region / assigned set) ────────────
create table app.user_roles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references app.users(id) on delete cascade,
  role_id     uuid not null references app.roles(id) on delete cascade,
  org_id      uuid not null references app.organizations(id) on delete cascade,
  -- optional ABAC scoping payload: { "region": "...", "assigned_employee_ids": [...] }
  scope       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, role_id, org_id)
);
create index user_roles_user_idx on app.user_roles(user_id);
create trigger touch_user_roles before update on app.user_roles
  for each row execute function app.touch_updated_at();

-- ── security-definer helpers used by RLS policies ───────────────────────────
-- These resolve the caller's org & permissions ONCE and are the single source
-- of truth RLS policies consult. SECURITY DEFINER so they can read app.* while
-- the caller's own grants are restricted.

create or replace function app.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = app
as $$
  select org_id from app.users where id = auth.uid();
$$;

-- Does the caller hold (resource, action|manage) at >= the given scope,
-- anywhere? Used for coarse gating; row-level ownership is checked per policy.
create or replace function app.has_permission(p_resource text, p_action text)
returns boolean
language sql
stable
security definer
set search_path = app
as $$
  select exists (
    select 1
    from app.user_roles ur
    join app.role_permissions rp on rp.role_id = ur.role_id
    join app.permissions perm on perm.id = rp.permission_id
    where ur.user_id = auth.uid()
      and perm.resource = p_resource
      and (perm.action = p_action or perm.action = 'manage')
  );
$$;

-- The broadest scope the caller holds for (resource, action), or null.
create or replace function app.max_scope(p_resource text, p_action text)
returns text
language sql
stable
security definer
set search_path = app
as $$
  select scope from (
    select perm.scope,
           case perm.scope when 'global' then 3 when 'org' then 2 when 'assigned' then 1 else 0 end as rank
    from app.user_roles ur
    join app.role_permissions rp on rp.role_id = ur.role_id
    join app.permissions perm on perm.id = rp.permission_id
    where ur.user_id = auth.uid()
      and perm.resource = p_resource
      and (perm.action = p_action or perm.action = 'manage')
  ) s
  order by s.rank desc
  limit 1;
$$;

-- Is the given employee in the caller's assigned set (any of the caller's roles)?
create or replace function app.is_assigned_employee(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = app
as $$
  select exists (
    select 1
    from app.user_roles ur
    where ur.user_id = auth.uid()
      and ur.scope -> 'assigned_employee_ids' @> to_jsonb(p_employee_id::text)
  );
$$;
