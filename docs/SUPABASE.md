# Supabase Auth & Storage — procurement-intel

The app is wired to the live Supabase project **procurement-intel** (`coaszrosqlhifcwxurwu`,
`https://coaszrosqlhifcwxurwu.supabase.co`). Everything lives in a dedicated **`app`** schema
and an **`hr-documents`** Storage bucket, fully isolated from the project's existing
`public` tables (procurement + timesheet apps). Supabase's built-in `auth.uid()` was **not**
overwritten — migration 0001 creates the local auth shim only if the functions are absent.

## What's applied (verified)

- **Schema:** all `app.*` tables, RLS policies, and helper functions (migrations 0001–0010),
  applied via the Supabase migration API. RLS enabled on every table.
- **Reference seed:** 4 roles, 66 permissions, 70 grants, 20 statuses.
- **Storage:** private `hr-documents` bucket with org-scoped `storage.objects` RLS
  (`{org_id}/…` path convention). No public buckets; signed time-limited URLs only.
- **Auth users provisioned** (email + password, pre-confirmed) with matching identities:

  | Email | Password | Role |
  |---|---|---|
  | `admin@hrdemo.example.com` | `HrDemo!2026` | Admin |
  | `hr@hrdemo.example.com` | `HrDemo!2026` | HR (assigned to Ravi) |
  | `consultant@hrdemo.example.com` | `HrDemo!2026` | Employee |

### Verified against the live project
- Password sign-in returns a JWT whose `sub` equals `app.users.id` (tested via `/auth/v1/token`).
- Under that JWT, `auth.uid()`, `app.current_org_id()`, and the permission helpers resolve
  correctly; the employee gets `own` scope and **no** audit access.
- Under the `authenticated` role with the employee's JWT, RLS returns only their own
  user/employee/case rows, **0** audit rows, and the 20 shared reference statuses.
- Security advisors: my RLS policies triggered **zero** "always-true" findings; `app`
  functions pin `search_path`.

## Frontend wiring

- **Auth:** `@supabase/ssr` server client (`lib/supabase/server.ts`) + `middleware.ts`
  refresh/guard. `lib/session.ts` resolves the caller from `supabase.auth.getUser()` →
  DB-backed `Principal`. Login is real email/password (`app/login/page.tsx`), MFA-ready.
- **Storage:** `lib/storage.ts` uploads to and mints signed URLs from `hr-documents`
  (`app/documents/page.tsx`). Uploads/downloads are authorized in the app layer first and
  sensitive access is audited.

## Finish setup (one step needs your DB password)

The server-side data layer connects to Postgres directly. Add to `apps/web/.env.local`
(copy from `.env.local.example`):

```
NEXT_PUBLIC_SUPABASE_URL=https://coaszrosqlhifcwxurwu.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_nO8n5IxHIdrZSYf6WN5Ixw_vlRcUOOl
SUPABASE_SERVICE_ROLE_KEY=<optional: Settings → API → service_role>
DATABASE_URL=postgres://postgres.coaszrosqlhifcwxurwu:<DB_PASSWORD>@aws-0-us-east-1.pooler.supabase.com:6543/postgres
PII_ENCRYPTION_KEY=<openssl rand -base64 32>
```

Then:

```bash
# Load the full 353 counsel-pending rules + transitions + document requirements
DATABASE_URL="postgres://postgres.coaszrosqlhifcwxurwu:<DB_PASSWORD>@aws-0-us-east-1.pooler.supabase.com:6543/postgres" \
  pnpm --filter @hr/db seed

pnpm --filter @hr/web dev   # sign in at /login with a demo account above
```

> Only the reference data needed to run (roles/permissions/statuses) was loaded via the
> management API to avoid pushing ~450KB of rule SQL through it. The full versioned rules
> load in seconds via the one `pnpm db:seed` command above.
