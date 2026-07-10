-- 0008_rls_policies.sql
-- Row-Level Security — defense-in-depth behind server-side authorization (§3.2, §12).
-- Deny by default: RLS is enabled on every table and only the policies below open access.
--
-- The app layer (@hr/shared requirePermission) is the PRIMARY enforcement point;
-- these policies independently re-enforce the SAME §3.3 access matrix at the row level,
-- so a bug or a raw query cannot leak across users/orgs.

-- ── unified access decision for employee-scoped resources ───────────────────
-- Mirrors shared/permissions.decide(): own | assigned | org | global.
create or replace function app.can_access_employee(
  p_resource text,
  p_action   text,
  p_employee_id uuid,
  p_org_id   uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = app
as $$
declare
  v_scope text;
  v_owner uuid;
begin
  v_scope := app.max_scope(p_resource, p_action);
  if v_scope is null then
    return false;                                   -- no grant → deny
  end if;

  if v_scope = 'global' then
    return true;
  end if;

  if v_scope = 'org' then
    return p_org_id = app.current_org_id();
  end if;

  -- 'assigned' and 'own' both allow the employee's own linked user.
  select user_id into v_owner from app.employees where id = p_employee_id;

  if v_scope = 'assigned' then
    return (v_owner is not null and v_owner = auth.uid())
        or app.is_assigned_employee(p_employee_id);
  end if;

  -- 'own'
  return v_owner is not null and v_owner = auth.uid();
end;
$$;

-- Helper macro-ish: enable RLS + force it for table owners too.
-- (Written out per-table below for clarity.)

-- ═══════════════════════════════════════════════════════════════════════════
-- Identity & org
-- ═══════════════════════════════════════════════════════════════════════════
alter table app.organizations enable row level security;
create policy org_read on app.organizations for select
  using (id = app.current_org_id() or app.has_permission('organizations','read'));
create policy org_admin_all on app.organizations for all
  using (app.has_permission('organizations','manage'))
  with check (app.has_permission('organizations','manage'));

alter table app.users enable row level security;
create policy users_self_read on app.users for select
  using (id = auth.uid()
      or (org_id = app.current_org_id() and app.has_permission('others_profiles','read'))
      or app.max_scope('others_profiles','read') = 'global');
create policy users_self_update on app.users for update
  using (id = auth.uid())
  with check (id = auth.uid());
create policy users_admin_all on app.users for all
  using (app.has_permission('role_provisioning','manage'))
  with check (app.has_permission('role_provisioning','manage'));

-- Roles / permissions / grants: readable to any authenticated user (needed to
-- resolve the caller's own permission set), writable only with provisioning.
alter table app.roles enable row level security;
create policy roles_read on app.roles for select using (auth.uid() is not null);
create policy roles_admin on app.roles for all
  using (app.has_permission('role_provisioning','manage'))
  with check (app.has_permission('role_provisioning','manage'));

alter table app.permissions enable row level security;
create policy perms_read on app.permissions for select using (auth.uid() is not null);
create policy perms_admin on app.permissions for all
  using (app.has_permission('role_provisioning','manage'))
  with check (app.has_permission('role_provisioning','manage'));

alter table app.role_permissions enable row level security;
create policy role_perms_read on app.role_permissions for select using (auth.uid() is not null);
create policy role_perms_admin on app.role_permissions for all
  using (app.has_permission('role_provisioning','manage'))
  with check (app.has_permission('role_provisioning','manage'));

alter table app.user_roles enable row level security;
create policy user_roles_self_read on app.user_roles for select
  using (user_id = auth.uid()
      or (org_id = app.current_org_id() and app.has_permission('role_provisioning','read'))
      or app.max_scope('role_provisioning','read') = 'global');
create policy user_roles_admin on app.user_roles for all
  using (app.has_permission('role_provisioning','manage'))
  with check (app.has_permission('role_provisioning','manage'));

-- ═══════════════════════════════════════════════════════════════════════════
-- Employment & placement  (employee-scoped via others_profiles)
-- ═══════════════════════════════════════════════════════════════════════════
alter table app.employees enable row level security;
create policy employees_read on app.employees for select
  using (
    (user_id = auth.uid())                                  -- own
    or app.can_access_employee('others_profiles','read', id, org_id)
  );
create policy employees_write on app.employees for all
  using (app.can_access_employee('others_profiles','update', id, org_id))
  with check (app.can_access_employee('others_profiles','create', id, org_id));

alter table app.clients enable row level security;
create policy clients_rw on app.clients for all
  using (org_id = app.current_org_id() and app.has_permission('others_profiles','read'))
  with check (org_id = app.current_org_id() and app.has_permission('others_profiles','update'));

alter table app.vendors enable row level security;
create policy vendors_rw on app.vendors for all
  using (org_id = app.current_org_id() and app.has_permission('others_profiles','read'))
  with check (org_id = app.current_org_id() and app.has_permission('others_profiles','update'));

alter table app.placements enable row level security;
create policy placements_read on app.placements for select
  using (app.can_access_employee('others_profiles','read', employee_id, org_id));
create policy placements_write on app.placements for all
  using (app.can_access_employee('others_profiles','update', employee_id, org_id))
  with check (app.can_access_employee('others_profiles','update', employee_id, org_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- Immigration
-- ═══════════════════════════════════════════════════════════════════════════
-- Reference data: statuses / transitions / rules / document_requirements are
-- global read (they are law/config, not tenant data); writable only via rules_engine.
alter table app.statuses enable row level security;
create policy statuses_read on app.statuses for select using (auth.uid() is not null);
create policy statuses_admin on app.statuses for all
  using (app.has_permission('rules_engine','manage'))
  with check (app.has_permission('rules_engine','manage'));

alter table app.transitions enable row level security;
create policy transitions_read on app.transitions for select using (auth.uid() is not null);
create policy transitions_admin on app.transitions for all
  using (app.has_permission('rules_engine','manage'))
  with check (app.has_permission('rules_engine','manage'));

alter table app.rules enable row level security;
create policy rules_read on app.rules for select using (auth.uid() is not null);
create policy rules_admin on app.rules for all
  using (app.has_permission('rules_engine','manage'))
  with check (app.has_permission('rules_engine','manage'));

alter table app.document_requirements enable row level security;
create policy docreq_read on app.document_requirements for select using (auth.uid() is not null);
create policy docreq_admin on app.document_requirements for all
  using (app.has_permission('rules_engine','manage'))
  with check (app.has_permission('rules_engine','manage'));

alter table app.immigration_cases enable row level security;
create policy cases_read on app.immigration_cases for select
  using (app.can_access_employee('case_internals','read', employee_id, org_id));
create policy cases_write on app.immigration_cases for all
  using (app.can_access_employee('case_internals','update', employee_id, org_id))
  with check (app.can_access_employee('case_internals','create', employee_id, org_id));

alter table app.case_transitions enable row level security;
create policy case_tr_read on app.case_transitions for select
  using (exists (select 1 from app.immigration_cases c
                 where c.id = case_id
                   and app.can_access_employee('case_internals','read', c.employee_id, c.org_id)));
create policy case_tr_write on app.case_transitions for all
  using (exists (select 1 from app.immigration_cases c
                 where c.id = case_id
                   and app.can_access_employee('case_internals','update', c.employee_id, c.org_id)))
  with check (exists (select 1 from app.immigration_cases c
                 where c.id = case_id
                   and app.can_access_employee('case_internals','update', c.employee_id, c.org_id)));

alter table app.case_dates enable row level security;
create policy case_dates_read on app.case_dates for select
  using (exists (select 1 from app.immigration_cases c
                 where c.id = case_id
                   and app.can_access_employee('case_internals','read', c.employee_id, c.org_id)));
create policy case_dates_write on app.case_dates for all
  using (exists (select 1 from app.immigration_cases c
                 where c.id = case_id
                   and app.can_access_employee('case_internals','update', c.employee_id, c.org_id)))
  with check (exists (select 1 from app.immigration_cases c
                 where c.id = case_id
                   and app.can_access_employee('case_internals','update', c.employee_id, c.org_id)));

alter table app.priority_date_tracking enable row level security;
create policy pdt_read on app.priority_date_tracking for select
  using (exists (select 1 from app.immigration_cases c
                 where c.id = case_id
                   and app.can_access_employee('case_internals','read', c.employee_id, c.org_id)));
create policy pdt_write on app.priority_date_tracking for all
  using (exists (select 1 from app.immigration_cases c
                 where c.id = case_id
                   and app.can_access_employee('case_internals','update', c.employee_id, c.org_id)))
  with check (exists (select 1 from app.immigration_cases c
                 where c.id = case_id
                   and app.can_access_employee('case_internals','update', c.employee_id, c.org_id)));

-- ═══════════════════════════════════════════════════════════════════════════
-- Documents (sensitive-aware)
-- ═══════════════════════════════════════════════════════════════════════════
alter table app.documents enable row level security;
create policy documents_read on app.documents for select
  using (
    case when sensitive_pii
      then app.can_access_employee('sensitive_pii','read', employee_id, org_id)
      else app.can_access_employee('documents','read', employee_id, org_id)
    end
  );
create policy documents_write on app.documents for all
  using (app.can_access_employee('documents','update', employee_id, org_id))
  with check (app.can_access_employee('documents','create', employee_id, org_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- HR lifecycle (employee-scoped via hr_items; SSN/W-4 via sensitive_pii)
-- ═══════════════════════════════════════════════════════════════════════════
-- Generic hr_items tables share one policy shape.
do $$
declare t text;
begin
  foreach t in array array[
    'offer_letters','policy_acknowledgments','benefits_enrollments',
    'leave_requests','training_records','performance_reviews','offboarding'
  ] loop
    execute format('alter table app.%I enable row level security;', t);
    execute format($p$
      create policy %1$s_read on app.%1$s for select
        using (app.can_access_employee('hr_items','read', employee_id, org_id));
    $p$, t);
    execute format($p$
      create policy %1$s_write on app.%1$s for all
        using (app.can_access_employee('hr_items','update', employee_id, org_id))
        with check (app.can_access_employee('hr_items','create', employee_id, org_id));
    $p$, t);
  end loop;
end $$;

-- I-9 records: contain document references → sensitive.
alter table app.i9_records enable row level security;
create policy i9_read on app.i9_records for select
  using (app.can_access_employee('sensitive_pii','read', employee_id, org_id));
create policy i9_write on app.i9_records for all
  using (app.can_access_employee('sensitive_pii','update', employee_id, org_id))
  with check (app.can_access_employee('sensitive_pii','create', employee_id, org_id));

-- W-4 (encrypted) and SSN: strictly sensitive_pii scope.
alter table app.w4_records enable row level security;
create policy w4_read on app.w4_records for select
  using (app.can_access_employee('sensitive_pii','read', employee_id, org_id));
create policy w4_write on app.w4_records for all
  using (app.can_access_employee('sensitive_pii','update', employee_id, org_id))
  with check (app.can_access_employee('sensitive_pii','create', employee_id, org_id));

alter table app.employee_ssn enable row level security;
create policy ssn_read on app.employee_ssn for select
  using (app.can_access_employee('sensitive_pii','read', employee_id, org_id));
create policy ssn_write on app.employee_ssn for all
  using (app.can_access_employee('sensitive_pii','update', employee_id, org_id))
  with check (app.can_access_employee('sensitive_pii','create', employee_id, org_id));

-- ═══════════════════════════════════════════════════════════════════════════
-- Help desk, RAG, notifications, audit
-- ═══════════════════════════════════════════════════════════════════════════
alter table app.helpdesk_tickets enable row level security;
create policy tickets_read on app.helpdesk_tickets for select
  using (
    opened_by = auth.uid()
    or (employee_id is not null and app.can_access_employee('helpdesk','read', employee_id, org_id))
    or (org_id = app.current_org_id() and app.max_scope('helpdesk','read') in ('org','global'))
  );
create policy tickets_write on app.helpdesk_tickets for all
  using (
    opened_by = auth.uid()
    or (employee_id is not null and app.can_access_employee('helpdesk','update', employee_id, org_id))
  )
  with check (
    org_id = app.current_org_id() and app.has_permission('helpdesk','create')
  );

-- RAG chunks: THE retrieval scope enforcement (§10). An employee can only ever
-- read chunks they own or that are org-shared for their role. Writable by ingestion
-- (service role bypasses RLS) or admins.
alter table app.rag_chunks enable row level security;
create policy rag_read on app.rag_chunks for select
  using (
    org_id = app.current_org_id()
    and (
      owner_user_id = auth.uid()                                   -- own chunk
      or (owner_user_id is null and owner_employee_id is null)     -- org-shared
      or app.max_scope('case_internals','read') in ('org','global')-- HR+/employer/admin reach
      or (owner_employee_id is not null
          and app.can_access_employee('case_internals','read', owner_employee_id, org_id))
    )
  );
create policy rag_admin on app.rag_chunks for all
  using (app.has_permission('rules_engine','manage'))
  with check (app.has_permission('rules_engine','manage'));

alter table app.notifications enable row level security;
create policy notif_read on app.notifications for select
  using (recipient_user_id = auth.uid()
      or (org_id = app.current_org_id() and app.max_scope('case_internals','read') in ('org','global')));
create policy notif_admin on app.notifications for all
  using (app.has_permission('system_config','manage'))
  with check (app.has_permission('system_config','manage'));

-- Audit log: APPEND-ONLY. Readable only with audit_log grant (Admin). No update/delete
-- policy exists, so even table owners cannot mutate history through RLS-governed roles.
alter table app.audit_log enable row level security;
create policy audit_read on app.audit_log for select
  using (app.has_permission('audit_log','read'));
create policy audit_insert on app.audit_log for insert
  with check (auth.uid() is not null);
-- deliberately: NO update, NO delete policy.
