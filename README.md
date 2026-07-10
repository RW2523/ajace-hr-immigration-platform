# HR & Immigration Lifecycle Platform

A single platform combining a full HR employee-lifecycle system with an immigration
case-management engine for a US staffing / consulting firm.

See [`BUILD_SPEC.md`](BUILD_SPEC.md) for the product specification and
[`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md) for the execution plan.

## Monorepo layout

```
apps/web              Next.js (App Router) frontend + server actions
packages/db           Postgres schema, migrations, RLS policies, seed loader
packages/shared       types, zod schemas, auth/permission helpers, encryption
packages/rules-engine immigration state machine + versioned rules validator
packages/workflow     case workflows + deadline scan (queue+cron, Temporal-ready)
packages/notifications tiered escalation + channel adapters
packages/rag          ingestion, embeddings, access-scoped retrieval
mcp/*                 five authorization-scoped MCP servers
data/immigration-seed versioned immigration rules seed (counsel-pending)
```

## Getting started

```bash
pnpm install
cp .env.example .env        # fill in secrets; DATABASE_URL defaults to the docker DB
pnpm db:start               # start local pgvector Postgres (docker)
pnpm db:migrate             # apply schema + RLS
pnpm db:seed                # load immigration seed data + roles/permissions
pnpm test                   # run all package tests
```

## Security posture

All authorization is enforced **server-side** (`packages/shared`), with Postgres
Row-Level Security as defense-in-depth. Sensitive PII (SSN, W-4, passport) is
encrypted at the application layer. Immigration rules are **versioned data**, never
constants in code, and are gated by `confirmed_by_counsel` until ratified. The system
is a status-and-deadline tracker, **not** a legal-advice tool. See `BUILD_SPEC.md` §12/§14.
