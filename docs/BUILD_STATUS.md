# Implementation Status

**As of 2026-07-07.** Built by Claude Code against `BUILD_SPEC.md` / `docs/BUILD_PLAN.md`.
Test DB: pgvector Postgres 16 (docker). **115 automated tests passing**, full monorepo typecheck clean,
and the Next.js frontend builds and runs end-to-end against the seeded database (verified in-browser).

## Delivered & tested

| Phase | Package(s) | What works | Tests |
|---|---|---|---|
| **0 Scaffold** | root, `@hr/shared` | pnpm+turbo monorepo; data-driven RBAC+ABAC permission model (§3.3 matrix); AES-256-GCM PII encryption; audit + seed zod schemas | 19 |
| **1 Foundation** | `@hr/db` | Full §6 schema (35+ tables) in 10 migrations; **RLS on every table** with a decision fn mirroring the app layer; idempotent seed loader (roles/permissions + 20 statuses, 29 transitions, 73 doc reqs, **353 counsel-pending rules**) | 18 RLS |
| **3 Rules engine** | `@hr/rules-engine` | Pure validator over versioned rules; `RuleIndex` with supersession + as-of resolution; edge-case clocks (OPT 90 / STEM 150 unemployment, grace, STEM 180-day, AC21 one-year, I-9 business days) | 18 |
| **3 Notifications** | `@hr/notifications` | Pure deadline scan (Appendix B, 42 triggers) with tiered escalation employee→HR→counsel, catch-up, idempotency; DB-backed runner + Resend/console channels | 10 |
| **2 HR core** | `@hr/hr` | SSN/W-4 encrypt→authorize→**audit** path; I-9 timing (business days from rules) + retention + List A XOR B+C + alt-procedure gate; offer-letter templating; adaptive onboarding checklist | 15 |
| **4 Edge/staffing** | `@hr/workflow` | Case engine (rules-validated advance, RFE/denial branches); **Simeio metro-change → amended-petition workflow**; offboarding → grace-period clock | 5 |
| **5 RAG** | `@hr/rag` | **Access-scoped retrieval** (no cross-user/cross-org leak, mirrors RLS); pgvector; OpenRouter assistant with **legal-advice guardrail** → counsel routing | 8 |
| **5 MCP (all 5 servers)** | `@hr/mcp-shared` + `case`/`rules`/`documents`/`hr`/`rag`-server | Identity→Principal resolver; **all five §11.1 servers** with authorization **inside every tool**, SDK wiring + annotations, signed-URL issuance + audited sensitive downloads, and eval tests including authorization-denial cases | 8 + 14 |
| **5 Frontend** | `apps/web` | Next.js App Router app: dev/Supabase-ready session→Principal; **role-aware dashboards** (employee/HR/employer/admin) over scoped data; adaptive intake; case detail w/ counsel-pending badge; assistant chat w/ legal guardrail; admin rules table (with counsel **ratify** action) + audit log. **`next build` passes; verified in-browser** end-to-end against the DB | (E2E) |

## Verified in-browser (against the seeded DB)

- HR signs in → sees only their **assigned** consultant, his STEM OPT case, pending I-9, and deadlines.
- Employee sees **their own** status but not the org roster; is **blocked** from the admin audit log ("Admin only").
- Admin sees the rules-engine summary and can ratify a rule (audited).
- Assistant routes a legal-judgment question ("Should I appeal my denial?") to counsel without generating.

## Live on Supabase (project procurement-intel) — see docs/SUPABASE.md

- **Real Supabase Auth** wired end-to-end: `@supabase/ssr` server client + middleware;
  `lib/session.ts` resolves the caller from `supabase.auth.getUser()`. Real email/password
  login. **Verified**: password sign-in returns a JWT whose `sub` == `app.users.id`; under
  that JWT `auth.uid()` + the permission helpers resolve, and RLS returns only the
  employee's own rows (0 audit rows) — proving the whole authz stack works on live Supabase.
- **Real Supabase Storage** wired: private `hr-documents` bucket with org-scoped
  `storage.objects` RLS; `lib/storage.ts` uploads + mints signed time-limited URLs;
  `app/documents/page.tsx` upload/download flow (authorized + audited).
- Schema (migrations 0001–0010) + reference seed (roles/permissions/statuses) applied to the
  `app` schema, fully isolated from the project's existing `public` tables. Supabase's built-in
  `auth.uid()` preserved (auth shim is create-if-absent).
- **One remaining step** to run the live UI: set `DATABASE_URL` (Supabase pooler + DB
  password) in `apps/web/.env.local`, then `pnpm --filter @hr/db seed` loads the full 353
  rules. Documented in docs/SUPABASE.md.

## Not yet built (documented, not started)

- Temporal adapter (deliberate: queue+cron chosen as the D1 default; interface is separable).
- E-signature provider, real email sending in CI, Slack/SMS channels (interfaces stubbed).
- Remaining HR module UIs (leave/training/reviews/benefits screens) — services + MCP tools exist; some screens are not yet drawn.
- TOTP MFA enrollment UI (Supabase Auth MFA is available; the enrollment/challenge screens are not yet drawn).

## Run it

```bash
pnpm install
pnpm db:start && pnpm db:migrate && pnpm db:seed
DATABASE_URL=postgres://postgres:postgres@localhost:54329/hr \
  PII_ENCRYPTION_KEY=$(openssl rand -base64 32) \
  pnpm -r --workspace-concurrency=1 exec vitest run --passWithNoTests
```

## Definition-of-done check (spec §13.4)

- ✅ Server-side authorization on every service/tool; **RLS enabled + tested** (18 isolation tests).
- ✅ Rules are versioned data; **zero immigration constants in code**; seed loaded `confirmed_by_counsel=false`.
- ✅ Appendix B triggers implemented with tiered escalation (simulated-clock tested).
- ✅ Sensitive PII encrypted (AES-GCM) and **all access audited** (tested).
- ✅ Rules validator, permission checks, case workflows, notification scheduling, MCP evals — green.
- ✅ Assistant never emits legal advice; routes legal judgment to counsel (tested).
- ◑ Frontend and 3 MCP servers scaffolded/pending per above.
