# Security posture

AJACE HR & Immigration Lifecycle Platform. This documents the controls in place and
the operational requirements for a secure production deployment.

## Identity & authorization
- **Auth**: Supabase Auth (email/password). Server-side session verified via
  `@supabase/ssr`; the user id is never taken from client input.
- **MFA**: optional TOTP (authenticator app) enrollment under **/security**, a
  sign-in step-up (`/login/mfa`), and an app-boundary gate — a password-only (aal1)
  session cannot reach any app route once a factor is enrolled.
- **RBAC + ABAC**: data-driven roles/permissions (`@hr/shared` `permissions.ts`),
  deny-by-default. Scopes: `own` / `assigned` / `org` / `global`.
- **Write-path IDOR guard**: every row mutation loads the target row first, calls
  `requirePermission(..., { requireContext: true, context: {orgId, employeeId, ownerUserId} })`,
  and constrains the `UPDATE`/`INSERT` by org. `requireContext` makes a context-less
  non-`global` scope check fail closed. Staff-vs-employee gating uses `hasStaffScope`,
  never role-key inspection.
- **RLS**: enabled deny-by-default on all `app.*` tables and covered by tests that
  run as the non-superuser `authenticated` role. App-layer scoping is the enforced
  primary; RLS is defense-in-depth. (Runtime RLS via a non-superuser request
  connection is a documented future hardening step.)

## Sensitive data (§12)
- **App-layer encryption** (AES-256-GCM, versioned envelope) for SSN, W-4, and
  immigration identifiers (passport / SEVIS / A-number) in dedicated tables
  (`employee_ssn`, `w4_records`, `employee_secure_ids`) — never in plaintext
  profile JSON. Requires `PII_ENCRYPTION_KEY` (32 bytes, base64); encryption fails
  closed if unset (no hardcoded fallback).
- **Sensitive documents**: OCR-extracted text of sensitive docs is encrypted at
  rest and kept OUT of the RAG index (metadata-only chunk), so PII is not
  retrievable via the assistant.
- **Audit log**: every sensitive-PII read/write records actor, resource, and time.
- **Storage**: private bucket, org-scoped object keys, signed time-limited URLs
  only; upload size cap + content-type allowlist.

## Transport & browser hardening
- **HTTP security headers** (`next.config.mjs`): `X-Content-Type-Options: nosniff`,
  `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, and in
  production `Strict-Transport-Security` (2y, preload) + `X-Frame-Options: DENY`.
  `x-powered-by` disabled.
- **Content-Security-Policy** (`middleware.ts`): per-request nonce; production
  `script-src 'self' 'nonce-…' 'strict-dynamic'` (no `unsafe-inline`),
  `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`,
  `form-action 'self'`, `upgrade-insecure-requests`. `connect-src`/`img-src`/
  `frame-src` scoped to self + the configured Supabase origin.
- **Cookies**: Supabase SSR sets `HttpOnly` / `Secure` / `SameSite` session cookies.

## Abuse & input
- **Rate limiting**: per-user cap on the assistant (paid LLM calls) and per-IP cap
  on sign-in, returning `429`. In-memory sliding window (per instance); for a hard
  global limit on multi-instance serverless, back `lib/rate-limit.ts` with Vercel
  KV / Upstash Redis.
- **Input validation**: request bodies type-checked and length-capped; the cron
  route is fail-closed and uses a constant-time secret compare.
- **Assistant**: access-scoped retrieval (a query can only return the caller's own
  chunks), a legal-advice guardrail before any model call, and a bounded question
  length.

## Operational requirements
- Set all secrets as environment variables (never commit): `DATABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `PII_ENCRYPTION_KEY`, `OPENROUTER_API_KEY`,
  `CRON_SECRET`. `.env*` is git-ignored.
- Use the Supabase **transaction pooler** (port 6543) for `DATABASE_URL` in
  serverless; the DB client disables prepared statements there automatically.
- Rotate any key that has ever been in a working tree or logs.
- `pnpm audit` is clean (a transitive PostCSS advisory is pinned via a workspace
  override).

## Reporting
Report suspected vulnerabilities privately to the repository owner. Do not open a
public issue for security reports.
