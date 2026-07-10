# @hr/web — Next.js frontend

Role-aware UI for the platform (spec §4). App Router, deployed on Vercel.

## Status

Scaffold with the app shell, server-side session→Principal resolution (`lib/session.ts`),
and a representative **case detail** page (`app/cases/[id]/page.tsx`) that authorizes
server-side, runs the real rules validator, and renders the §14 counsel-pending
indicator. This demonstrates the end-to-end wiring from UI → `@hr/shared` authorization
→ `@hr/rules-engine` → the versioned rules data.

To run:

```bash
pnpm install                     # pulls next/react (not installed in the headless build)
cp ../../.env.example .env.local # set DATABASE_URL, SUPABASE_*, DEMO_USER_ID
pnpm --filter @hr/web dev
```

## Remaining UI work (per BUILD_PLAN §5, frontend agent)

Role dashboards (employee/HR/employer/admin), adaptive intake form, onboarding
checklist, document upload with signed URLs, HR module screens, helpdesk + assistant
chat, and admin rules/templates/audit views. Auth flows use Supabase Auth (email + MFA).

Security note: role-based rendering here is a UX convenience only — the server
(`requirePermission` + RLS) is the enforcement point. The page never relies on hiding
fields for security.
