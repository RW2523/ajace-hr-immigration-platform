# HR & Immigration Lifecycle Platform — Build Specification

> **Purpose of this file:** This is a complete, self-contained build brief for **Claude Code**. It describes an end-to-end web application that combines a full HR employee-lifecycle system with an immigration case-management engine for a US staffing/consulting firm. Read this document top to bottom, set up the subagents in §13, then build in the phased order in §13.3. Do not skip sections — every layer described here is in scope.

---

## 0. Instructions to Claude Code (read first)

1. **Set up the subagents** defined in §13.1 as files under `.claude/agents/`. Each subagent owns a domain and has a scoped system prompt.
2. **Read the relevant skills before building** each part: `frontend-design` for any UI, `mcp-builder` for the MCP servers, and the document skills (`docx`, `pdf`) for offer-letter and form generation.
3. **Follow the phases in §13.3.** Do not attempt everything at once. Each phase has a definition of done (§13.4).
4. **The immigration rules in Appendix A are seed data, not gospel.** They were compiled from USCIS, ICE/SEVP, DOL, and the State Department and are current as of mid-2026, but immigration law changes constantly. Store them as **versioned data** (§7.5) with an `effective_date` and a `confirmed_by_counsel` flag. The application must never hard-code these values into business logic, and must route anything resembling legal judgment to the firm's immigration counsel (§14).
5. **Security is non-negotiable.** This system stores SSNs, passport data, and immigration documents. Follow §12 exactly. Enforce authorization on the server for every request; never trust the client to scope access.
6. **Ask before assuming** on the four open decisions listed in §15 if they block progress; otherwise proceed with the documented defaults and note the assumption in code comments.

---

## 1. Product overview & goals

A single platform with two tightly integrated domains:

- **HR employee lifecycle:** onboarding, benefits enrollment guidance, offer letters, I-9 / W-4 collection, policy acknowledgment, leave requests, training records, performance reviews, an HR helpdesk, and offboarding.
- **Immigration case management:** a state machine covering every work-authorization category the firm hires (US citizens/permanent residents, F-1 CPT/OPT/STEM OPT, H-1B cap/transfer/extension/amendment, and the employment-based green-card process), with adaptive document collection, a deadline/notification engine, and a rules validator.

Cross-cutting layers: role-based access control, a RAG-powered help desk, a role-aware AI assistant exposed through MCP, document storage, scheduled notifications, and an audit log.

**Primary goal:** every person sees exactly the data appropriate to their role; every immigration deadline is tracked and proactively notified; every HR lifecycle step is captured; and the AI assistant can answer questions and take actions scoped to the caller's permissions.

---

## 2. Business context

- The firm is a **US staffing/consulting company** whose primary business is **placing consultants at client sites**. It also does **direct-hire** employment.
- The firm **sponsors** work visas and hires: US citizens, green-card holders, F-1 students (CPT/OPT/STEM OPT), and H-1B workers (new cap, transfers, extensions, amendments), and supports them through the green-card process.
- The data model must therefore support **two employment types**:
  - **Placement (staffing):** consultant employed by the firm but working at a client, with client, project, placement dates, and possibly a vendor/prime layer.
  - **Direct-hire:** employee works directly for the firm, no client placement.
- Employment type changes the immigration compliance surface (see §7.6 for third-party placement obligations).

---

## 3. Roles & access model

### 3.1 Role hierarchy (highest privilege first)

1. **Admin** — platform superuser. Provisions and manages Employer accounts, assigns roles, configures the system, manages the rules table and templates, and views the audit log. Full access, always logged.
2. **Employer** — the firm's owner/leadership. **Full operational access** to their organization's data (all employees, placements, cases, documents, HR records). Below Admin: cannot do system configuration, role provisioning, or edit the rules engine.
3. **HR** — scoped operational role. Runs HR lifecycle workflows and coordinates immigration cases (status, deadlines, document collection) for employees in their scope. Need-to-know access to sensitive PII.
4. **Employee** — own data only: own profile, own immigration status/deadlines/documents, own HR items (leave, reviews, training), and a help desk scoped to their own situation.

### 3.2 Access model = RBAC + ABAC, enforced server-side

Use **role-based access control** for the coarse cut and **attribute/ownership-based rules** for the fine cut (e.g., scope by org, region, or assigned employees). **All authorization is enforced on the server** against the authenticated identity — never by hiding fields in the UI, and never by trusting a client-supplied scope. Back this with **Postgres Row-Level Security** as defense-in-depth (§12).

### 3.3 Access matrix

| Data | Employee | HR | Employer | Admin |
|---|---|---|---|---|
| Own profile & HR items | Full (own) | Full (in scope) | Full | Full |
| Others' profiles | — | In scope | All org | All |
| Immigration case internals | Own status & deadlines | Status, deadlines, docs needed | Full | Full |
| Sensitive PII (SSN, passport, I-9 docs) | Own | Need-to-know | Full | Full (logged) |
| Work-authorization validity (authorized? until when?) | Own | Yes | Yes | Yes |
| Rules engine, templates, role provisioning, audit log | — | — | — | Full |

### 3.4 Extensibility

Roles must be **data-driven and extensible**, not hard-coded to these four. Design so the firm can later add: a dedicated **Immigration Coordinator** (distinct from general HR), and **external Attorney / Paralegal** roles (read/annotate case data, no HR access). Model roles + permissions as rows, not enums baked into code.

---

## 4. Architecture & tech stack

- **Frontend:** Next.js (App Router) + TypeScript, deployed on **Vercel**. Role-based UI rendering. Follow the `frontend-design` skill for all UI.
- **Backend:** Next.js server actions / route handlers **plus** a dedicated service layer for the workflow engine and MCP servers. All authorization lives in the backend.
- **Database & platform:** **Supabase** — Postgres (system of record) with **Row-Level Security**, **Supabase Auth** (email signup/login + MFA), **Supabase Storage** (encrypted document buckets with access policies), and **pgvector** for RAG embeddings so retrieval data is governed by the same access controls as relational data.
- **Workflow / deadline engine:** **Temporal** is the recommended fit for long-running immigration workflows with human steps and timers. If a lighter start is preferred, use a queue + cron (e.g., Supabase scheduled functions / a job runner) — but design the deadline engine as a separable service.
- **Notifications:** email via a provider (e.g., Resend / SES / SendGrid) + in-app; optional Slack/SMS.
- **AI assistant & RAG:** an LLM with retrieval over pgvector, exposed to the app through **MCP servers** (§11) whose tools are authorization-scoped.
- **MCP:** the app runs its own MCP servers (§11) built per the `mcp-builder` skill (TypeScript SDK, streamable HTTP for remote, stdio for local).

---

## 5. Repository structure

```
/apps
  /web                      # Next.js frontend + server actions
/packages
  /db                       # Supabase schema, migrations, RLS policies, seed
  /rules-engine             # immigration rules validator (reads versioned rules data)
  /workflow                 # Temporal workflows/activities (deadline & case engine)
  /notifications            # notification service (scan + tiered escalation + channels)
  /rag                      # ingestion, chunking, embeddings, access-scoped retrieval
  /shared                   # types, auth helpers, permission checks, zod schemas
/mcp
  /case-server              # MCP: immigration case data (role-scoped)
  /documents-server         # MCP: document storage access (role-scoped)
  /rules-server             # MCP: rules/validator queries
  /hr-server                # MCP: HR lifecycle actions (role-scoped)
  /rag-server               # MCP: help-desk retrieval (access-scoped)
/.claude
  /agents                   # subagent definitions (§13.1)
/docs                       # this spec + generated design docs
```

---

## 6. Data model

Postgres via Supabase. Every table has `id (uuid)`, `created_at`, `updated_at`, and (where applicable) `org_id` for RLS scoping. Below is the required schema; the DB subagent should finalize types, indexes, and RLS policies.

### 6.1 Identity & org
- **organizations** — the Employer's org (multi-tenant boundary).
- **users** — links to Supabase Auth; `email`, `full_name`, `status`.
- **roles** — data-driven roles (`admin`, `employer`, `hr`, `employee`, extensible).
- **user_roles** — user↔role, optionally scoped (org/region/assigned set).
- **permissions** / **role_permissions** — fine-grained permission grants.

### 6.2 Employment & placement
- **employees** — profile; `employment_type` enum (`placement` | `direct_hire`); `work_authorization_category` (see §7.1); hire date; manager.
- **clients** — end-client companies (staffing).
- **vendors** — prime/vendor layer where applicable.
- **placements** — employee↔client; project name; start/end; worksite address (metro area); vendor_id; supporting docs (client letter, SOW, per-worksite LCA reference, itinerary).

### 6.3 Immigration
- **immigration_cases** — one per employee-track; `current_status` (FK to statuses); `country_of_birth` (for priority-date/backlog logic); attorney_of_record.
- **statuses** — the status taxonomy (§7.1) as data.
- **case_transitions** — history of moves between statuses; `from_status`, `to_status`, `transition_type`, `initiated_by`, `filed_on`, `receipt_number`, `decision`, `decision_date`.
- **case_dates** — every tracked date per case (I-94, EAD start/end, OPT end, STEM validations, H-1B validity, priority date, PERM filed, passport expiry, RFE due, etc.) with a `date_type` and value.
- **rules** — **versioned** immigration rules (§7.5): `status_or_transition_key`, `attribute`, `value`, `effective_date`, `source`, `confirmed_by_counsel`, `superseded_by`.
- **priority_date_tracking** — case priority date + preference category + country + latest visa-bulletin position.

### 6.4 Documents
- **documents** — per employee / per case / per type; storage key (Supabase Storage), version, `document_type`, `uploaded_by`, retention metadata. Access-controlled; signed time-limited URLs only.
- **document_requirements** — which document slots exist for a given status/transition (drives adaptive intake §7.3).

### 6.5 HR lifecycle
- **offer_letters** — template, variables, generated file, e-signature status.
- **i9_records** — Section 1 / Section 2 timestamps, list A/B/C doc references, E-Verify case id, alternative-procedure flag, retention date.
- **w4_records** — collected W-4 data (encrypted).
- **policy_acknowledgments** — policy version, employee, acknowledged_at.
- **benefits_enrollments** — enrollment selections/status.
- **leave_requests** — type, dates, status, approver.
- **training_records** — course, completion, expiry.
- **performance_reviews** — cycle, ratings, comments, participants.
- **offboarding** — checklist, last day, triggers immigration grace-period clock.

### 6.6 Help desk, assistant, audit
- **helpdesk_tickets** — subject, body, status, assignee, scope.
- **rag_chunks** — text chunks + pgvector embedding + **access metadata** (owner, role-visibility, doc type) used to enforce retrieval scoping.
- **notifications** — recipient, channel, type, related date, sent_at, escalation_level.
- **audit_log** — actor, action, resource, timestamp, before/after (append-only; all access to sensitive PII logged).

---

## 7. Immigration domain

This is the core. Model the immigration lifecycle as a **finite state machine**: each work-authorization category is a **state**, and each move is a **transition** with four attached properties — **preconditions** (eligibility), **required documents**, **timing window**, and **responsible party** (employee uploads / HR files / attorney reviews).

### 7.1 Status taxonomy (states)

Store as data in `statuses`. Categories:

- **No sponsorship needed:** `us_citizen`, `permanent_resident` (LPR).
- **F-1 track:** `f1_studying`, `f1_cpt`, `f1_opt`, `f1_stem_opt`.
- **H-1B track:** `h1b_active`, `h1b_cap_gap`, `h1b_transfer_pending`, `h1b_extension_pending`, `h1b_amendment_pending`.
- **Green-card process (overlay — runs while on H-1B/other):** `perm_filed`, `perm_approved`, `i140_pending`, `i140_approved`, `i485_pending`, `consular_pending`, → `permanent_resident`.
- Extensible for `l1`, `o1`, `tn`, etc. (design so adding a category is data, not code).

### 7.2 State machine — transitions

Each transition below must encode preconditions, required documents, timing window, and responsible party. The rules engine (§7.5) reads the concrete values from versioned data.

| Transition | Preconditions (summary) | Timing window | Responsible |
|---|---|---|---|
| `f1_studying → f1_cpt` | 1 full academic year enrolled (exceptions); integral to curriculum | Per program; DSO authorizes on I-20 | Employee/DSO |
| `f1_cpt → f1_opt` | Degree level completing; cumulative full-time CPT < 12 months | 90 days before to 60 days after program end | Employee/DSO + USCIS |
| `f1_opt → f1_stem_opt` | STEM CIP degree; E-Verify employer; I-983 | Up to 90 days before OPT EAD expiry; ≤60 days after DSO rec | Employee/DSO + USCIS |
| `f1_opt / f1_stem_opt → h1b_active` | Cap selection; timely petition; COS | Registration Mar; petition Apr–Jun; start Oct 1 | HR/Attorney + USCIS |
| `(OPT/STEM) → h1b_cap_gap` | Timely cap-subject COS petition filed | Auto on filing; ends Apr 1 or petition start | Automatic |
| `h1b_active → h1b_transfer_pending` | New employer petition | Portability: work on receipt | HR/Attorney |
| `h1b_active → h1b_extension_pending` | Within 6-yr limit OR AC21 basis | Up to 6 months before expiry; 240-day rule | HR/Attorney |
| `h1b_active → h1b_amendment_pending` | Material change (worksite metro / role) | Before/at change | HR/Attorney |
| `h1b_active → perm_filed` | GC sponsorship decision | Any time | Employer/Attorney |
| `perm_filed → perm_approved → i140_pending → i140_approved` | Sequential | Per processing | Attorney/USCIS |
| `i140_approved → i485_pending` (or consular) | Priority date current per controlling chart | When current | Attorney/USCIS |
| `i485_pending → permanent_resident` | Approval | Per processing | USCIS |
| `i140_approved → h1b_extension_pending` (AC21) | Approved I-140 + PD not current (§104c) OR PERM/I-140 pending ≥365d (§106a) | Per §7.7 | HR/Attorney |

### 7.3 Adaptive intake

Intake is a **dynamic, branching form** driven by the same taxonomy. The person first selects their work-authorization category; the system then requests only the documents/fields for that category (via `document_requirements`). Examples:
- **F-1 OPT** → EAD card, I-20 with OPT recommendation, OPT start/end dates, SEVIS ID.
- **H-1B** → I-797 approval notice, I-94, LCA, validity dates, passport.
- **Green-card in progress** → PERM/I-140 receipts, priority date, preference category, EAD/AP if applicable.

### 7.4 Edge cases (must all be handled)

- **Cap-gap** work authorization when OPT/STEM expires but a timely H-1B COS petition is pending (now bridges to **April 1**, see §7.7). Active OPT → status **and** work auth; grace-period → status **only**.
- **OPT unemployment clock:** 90 days (post-completion), 150 aggregate for STEM (includes the 90). Counts calendar days from EAD start; days abroad count (narrow exceptions); cap-gap does **not** pause it.
- **STEM reporting:** validation reports at 6/12/18/24 months; material changes within 10 days; employer reports departure within 5 days; missing reports → SEVIS "failure to report" termination.
- **H-1B 6-year max** and **AC21** extensions (§104(c) 3-year; §106(a) 1-year) — including the **"one year to file I-485"** trap and the **I-140 not withdrawn within 180 days** rule.
- **H-1B portability** (work on receipt for transfers) and **amended petition** required for worksite metro change.
- **Priority-date retrogression:** I-485 stays pending; EAD/AP renew; priority date not reset.
- **Change of status vs. consular processing** (affects $100k-fee applicability and cap-gap).
- **Grace periods:** 60-day H-1B grace on termination; F-1 60-day grace after OPT.
- **RFE / denial / re-file** branches on any transition.
- **Concurrent filing** (I-140 + I-485 + I-765 + I-131) when priority date is current.
- **Same-or-similar portability** once I-485 pending 180+ days and I-140 approved.

### 7.5 The rules engine / validator

- Rules live in the `rules` table as **versioned rows** with `effective_date`, `source`, `confirmed_by_counsel`, and `superseded_by`.
- The validator is a pure function: given a case's current status, dates, and attributes, it returns eligibility for each possible transition, the documents still required, and any deadline violations — **by reading the rules table**, never by hard-coded constants.
- Updating a rule (law change, fee change) = inserting a new versioned row, not a code deploy.
- The seed values are in **Appendix A**. Load them with `confirmed_by_counsel = false` until the firm's counsel ratifies each.

### 7.6 Third-party placement compliance (staffing-critical)

For consultants placed at client sites, store per placement: the **client / end-client letter**, the **statement of work / work order**, the **per-worksite LCA**, and the **itinerary**. USCIS conducts site visits including at third-party client locations, remote worksites, and home offices — so the system must keep this evidence current and **trigger an amended-petition workflow whenever a placement's worksite changes metro area**.

### 7.7 Immigration rules reference

The concrete validity periods, windows, limits, reporting cadences, fees, and the 2025–2026 changes are compiled in **Appendix A** as structured seed data. **Every value must be validated by the firm's immigration counsel before it drives any user-facing decision.**

---

## 8. HR lifecycle modules

Each module shares the same auth, document store, and notification plumbing.

- **Onboarding** — orchestrates the new-hire flow: profile creation, adaptive immigration intake, document collection, I-9/W-4, policy acknowledgment, benefits enrollment. A checklist with owners and due dates.
- **Enrollment guidance** — benefits selection with guidance; capture elections and status.
- **Offer letters** — generate from templates with variables; produce a file (use `docx`/`pdf` skills); route for e-signature; track status.
- **I-9 / W-4 collection** — I-9 Section 1 by day one, Section 2 within 3 business days (both by day one if employment < 3 days); List A or B+C; unexpired docs; E-Verify case within 3 business days; alternative remote procedure only for E-Verify employers in good standing (live video, retain front/back copies, check the box); retention = 3 years after hire or 1 year after termination, whichever is later; receipt rule = 90 days. Store W-4 data encrypted. Full values in Appendix A.
- **Policy acknowledgment** — publish policy versions; capture per-employee acknowledgment with timestamps.
- **Leave requests** — request/approve workflow with balances and approver routing.
- **Training records** — assign, track completion, flag expiry.
- **Performance reviews** — cycles, self + manager input, ratings, sign-off.
- **HR helpdesk** — ticketing, scoped by role; integrated with the RAG assistant (§10).
- **Offboarding** — checklist, access revocation, final documents; **triggers the immigration grace-period clock** (e.g., H-1B 60-day grace) and notifies HR/counsel.

---

## 9. Notifications & deadline engine

A scheduled job scans all tracked dates and fires **tiered, escalating** reminders: employee → HR → counsel, across email + in-app (optional Slack/SMS). Reminder offsets are configurable per date type (e.g., 120/90/60/30/7 days).

**Dates to watch (notification triggers):** I-94 expiry; EAD start (unemployment-clock trigger) and expiry; OPT end; STEM validation dates (6/12/18/24) + STEM EAD expiry + 180-day auto-extension boundary; cap-gap April 1 cutoff; H-1B validity expiry + 6-month extension-filing window; AC21 "one year to file I-485" clock once priority date goes current; PERM validity (180 days to file I-140); priority-date-approaching-current (within ~6 months); EAD/AP renewal during pending I-485; passport expiry; I-9 Section 2 and E-Verify 3-business-day deadlines; RFE response deadlines. The full catalog is in **Appendix B**.

---

## 10. RAG help desk & role-aware AI assistant

- **One assistant, per-role capabilities and data access**, resolved from the caller's identity.
- **Access-scoped retrieval is mandatory.** Every `rag_chunks` row carries access metadata (owner, role-visibility, doc type). The retrieval query is scoped by the caller's permissions **on the server** before any chunk reaches the model. An employee must never retrieve another person's case data.
- **What each role gets:** employees ask about their own case, deadlines, next steps, and general policy; HR queries across their scope and drafts documents; Employer/Admin get org-wide reach. The assistant reaches data and takes actions **only** through the MCP servers in §11, whose tools are authorization-scoped.
- **Legal guardrail:** the assistant tracks status and deadlines but must not give immigration legal advice; anything resembling a legal judgment is routed to counsel (§14).

---

## 11. MCP architecture

Build the app's AI-assistant layer as **MCP servers** (per the `mcp-builder` skill: TypeScript SDK; streamable HTTP for remote, stdio for local; Zod input + output schemas; `readOnlyHint`/`destructiveHint`/`idempotentHint` annotations; actionable errors; consistent `snake_case` tool names with server prefixes). **Every tool authorizes against the caller's identity server-side** and returns only permitted data.

### 11.1 MCP servers & representative tools

- **case-server** — `case_get_status`, `case_list_deadlines`, `case_check_transition_eligibility`, `case_list_required_documents`, `case_record_transition` (write; destructive hint).
- **documents-server** — `docs_list_for_case`, `docs_get_signed_url` (time-limited), `docs_request_upload`, `docs_check_requirements`.
- **rules-server** — `rules_get` (by status/transition), `rules_validate_case`, `rules_list_effective` (read-only).
- **hr-server** — `hr_get_onboarding_status`, `hr_create_leave_request`, `hr_get_review_cycle`, `hr_list_pending_i9`, `hr_generate_offer_letter` (write).
- **rag-server** — `rag_search` (access-scoped retrieval), `rag_answer` (retrieval + generation, scoped).

### 11.2 Rules

- Authorization is enforced inside each tool; the MCP transport identity is mapped to a user and permission set. Never accept a client-supplied scope/role.
- Prefer comprehensive coverage of the underlying operations plus a few high-level workflow tools (e.g., `case_check_transition_eligibility` composes rules + dates + documents).
- Provide evaluations for each server per the `mcp-builder` evaluation guide.

---

## 12. Security, privacy & compliance

- **Auth:** Supabase Auth with email verification + **MFA** (required given sensitive data).
- **Authorization:** enforced server-side on every request; **Postgres RLS** as defense-in-depth; deny by default.
- **Encryption:** TLS in transit; encryption at rest for the DB and Storage; encrypt sensitive columns (SSN, W-4, passport) at the application layer as well.
- **Documents:** Supabase Storage with per-object access policies; **signed, time-limited URLs only**; no public buckets.
- **Audit:** append-only `audit_log`; **all access to sensitive PII is logged** (actor, resource, time).
- **Retention:** implement I-9 retention (3 years after hire or 1 year after termination, whichever later); define retention/deletion policies for other PII.
- **Least privilege:** the access matrix (§3.3) is the ceiling; RAG retrieval and MCP tools must respect it.
- **Not legal advice:** the system and assistant never provide immigration legal advice; see §14.
- Consider SOC 2 alignment as the system matures.

---

## 13. Claude Code build plan

### 13.1 Subagents (create under `.claude/agents/`)

Each subagent has a focused scope, its own system prompt, and the minimum tools it needs. The **orchestrator** (main agent) coordinates them and integrates their output.

1. **architect** — owns the overall design, repo structure, cross-cutting decisions, and keeps this spec's constraints enforced. Reviews other agents' output for consistency.
2. **db-schema** — owns `/packages/db`: Postgres schema, migrations, **RLS policies**, and seed (including loading Appendix A rules with `confirmed_by_counsel=false`). Deliver an ERD.
3. **auth-rbac** — owns identity, roles/permissions (data-driven + extensible), server-side authorization helpers, and MFA. Produces the permission-check middleware every other layer uses.
4. **immigration-rules** — owns `/packages/rules-engine`: the state machine, the versioned rules validator, adaptive-intake logic, and all §7.4 edge cases. Treats Appendix A as seed data pending counsel sign-off.
5. **workflow-notifications** — owns `/packages/workflow` + `/packages/notifications`: Temporal (or queue+cron) case workflows, the deadline scan, and tiered escalation across channels. Implements Appendix B triggers.
6. **hr-modules** — owns the §8 HR lifecycle modules, including offer-letter/form generation (uses `docx`/`pdf` skills) and I-9/W-4 flows.
7. **rag-assistant** — owns `/packages/rag`: ingestion, chunking, embeddings in pgvector, and **access-scoped retrieval**. Wires the assistant to the MCP servers.
8. **mcp-servers** — owns `/mcp/*`: builds each MCP server per the `mcp-builder` skill with authorization inside every tool, output schemas, annotations, and evaluations.
9. **frontend** — owns `/apps/web`: role-based UI per the `frontend-design` skill; renders only permitted data; consumes the backend/MCP layer.
10. **security-compliance** — reviews every layer against §12; owns audit logging, encryption of sensitive columns, retention policies, and the not-legal-advice guardrails. Has veto over merges that violate §12.
11. **qa-testing** — owns tests: unit tests for the rules validator and permission checks, integration tests for the case workflows and notifications, and MCP evaluations.

Subagent prompt templates are in **Appendix D**.

### 13.2 MCP servers to build

The five servers in §11.1, each following `mcp-builder`. Start with `case-server`, `rules-server`, and `documents-server` (they back the core assistant), then `hr-server` and `rag-server`.

### 13.3 Build phases (do in order)

- **Phase 1 — Foundation:** Supabase project; `db-schema` (tables + RLS + seed); `auth-rbac` (email + MFA + roles/permissions + server-side authz); encrypted `documents` store. **DoD:** a user can sign up, get a role, and RLS provably blocks cross-user access.
- **Phase 2 — HR core:** profiles; adaptive immigration intake (form only); offer letters; I-9/W-4; policy acknowledgment; benefits enrollment. **DoD:** a new hire can be onboarded end-to-end with documents stored and I-9 timing enforced.
- **Phase 3 — Immigration engine + notifications:** the state machine for the linear path (F-1 → OPT → H-1B → green card); the versioned rules validator; `case_dates`; the deadline scan + tiered notifications. **DoD:** a case advances through statuses, the validator reports eligibility/violations from rules data, and deadline reminders fire on a schedule.
- **Phase 4 — Edge cases + staffing:** cap-gap, STEM reporting, AC21, RFE/denial branches, third-party placement compliance + amended-petition workflow, and full role scoping incl. Employer/Admin. **DoD:** all §7.4 edge cases pass tests; worksite-metro change triggers an amendment workflow.
- **Phase 5 — RAG help desk + assistant over MCP:** access-scoped retrieval; the five MCP servers; the role-aware assistant. **DoD:** an employee's assistant answers only from their own scope; MCP tools authorize server-side; evaluations pass.

### 13.4 Definition of done (global)

- Server-side authorization on every endpoint and MCP tool; RLS enabled and tested.
- Rules are versioned data; no immigration constants in code; seed loaded as `confirmed_by_counsel=false`.
- All Appendix B deadline triggers implemented with tiered escalation.
- Sensitive PII encrypted and all access to it logged.
- Tests: rules validator, permission checks, case workflows, notification scheduling, and MCP evaluations all green.
- The assistant never emits legal advice and routes legal judgment to counsel.

---

## 14. Guardrails & legal disclaimers

- **The application is a status-and-deadline tracker, not a legal-advice tool.** It must not generate immigration legal advice. Any output that would constitute a legal judgment (eligibility determinations presented as legal conclusions, filing strategy, responses to RFEs, etc.) must be routed to the firm's licensed immigration counsel.
- **The rules in Appendix A are seed data pending ratification.** Present them in the product only after counsel confirms each (`confirmed_by_counsel=true`), and surface an "as-of / confirmed-by-counsel" indicator in the UI.
- **Fees and dates drift.** Where feasible, pull current fees/dates from official sources at build/review time and keep the rules table current via counsel review, not code edits.

---

## Appendix A — Immigration rules seed (structured)

> Compiled from USCIS, ICE/SEVP, DOL, and the US Department of State; current as of mid-2026. **Load as versioned rows with `confirmed_by_counsel=false`.** Values below are the seed the validator reads.

### A.1 F-1 CPT
- Requires: one full academic year enrolled first (narrow exceptions); integral to curriculum.
- Authorization: DSO on I-20; no USCIS filing / no EAD.
- Constraint: **≥12 months full-time CPT eliminates OPT eligibility** at that degree level (track cumulative full-time CPT days).

### A.2 F-1 OPT (post-completion)
- Duration: 12 months per degree level (pre-completion OPT used is deducted).
- Application window: 90 days before program end → 60 days after; USCIS must receive within 30 days of the DSO's SEVIS recommendation.
- Work start: only on EAD start date, card in hand.
- Unemployment limit: **90 aggregate days** from EAD start; exceeding → possible SEVIS termination. (8 CFR 214.2(f)(10)(ii)(E))
- Employment: directly related to degree; ≥20 hrs/week; US employer.
- Grace period: 60 days after EAD expiry.

### A.3 STEM OPT extension
- Duration: 24 months, once per qualifying degree level.
- Eligibility: STEM CIP degree on DHS list; employer enrolled in E-Verify; Form I-983 training plan.
- Application window: up to 90 days before OPT EAD expiry; ≤60 days after DSO STEM recommendation.
- Work continuity: timely filing auto-extends work authorization up to **180 days** past OPT EAD expiry while pending.
- Unemployment limit: **150 aggregate days**, inclusive of the 90 already used (does not reset).
- Reporting: validation reports at **6/12/18/24 months**; material changes within **10 days**; employer reports departure within **5 days**.

### A.4 Cap-gap (OPT/STEM → H-1B) — changed 2025
- Under the H-1B modernization rule effective **Jan 17, 2025**, cap-gap now ends **April 1** of the relevant fiscal year (previously October 1); a pending timely petition sustains authorization into April.
- Activates automatically on a timely cap-subject petition requesting **change of status** (not consular).
- Active OPT/STEM → status **and** work authorization; 60-day grace → status **only**.
- Not available for cap-exempt employers. Does **not** pause the OPT unemployment clock.
- I-9 proof: H-1B receipt (I-797C) + cap-gap I-20.

### A.5 H-1B cap, registration & selection — changed 2025–2026
- Cap: **65,000** regular + **20,000** US master's.
- FY2027 registration: **March 4–19, 2026**; **$215** per registration; selections by **March 31, 2026**.
- Petition filing: 90-day window from selection (~Apr 1–Jun 30); start date **Oct 1** or later.
- **Wage-weighted selection (new, effective Feb 27, 2026):** entries scale with OEWS wage level (Level IV = 4 entries … Level I = 1); SOC code + wage level required at registration.
- **$100,000 supplemental fee (new, Sept 19, 2025 proclamation):** generally applies when the beneficiary is outside the US without a valid H-1B visa or where COS can't be granted; **does not apply** to an in-US change-of-status petition (e.g., F-1 OPT) that is approved.
- Employer-paid fees: I-129 base; Fraud Prevention ($500); ACWIA ($750–$1,500 by size); Asylum Program fee; PL 114-113 $4,000 for 50+ employee firms that are >50% H-1B/L-1.
- Premium processing: **$2,965** as of March 1, 2026 (either party may pay).

### A.6 H-1B transfer / amendment / 6-year limit + AC21
- Portability (§105): new employer's petition allows work **on receipt**.
- Amended petition required for a **material change** (worksite outside original metro area; significant role change).
- Max stay: **6 years** (typically 3+3).
- AC21 §106(a): **1-year** extensions if PERM/I-140 filed **≥365 days** before the 6th year and not finally decided (a pending PERM/I-140 suffices).
- AC21 §104(c): **3-year** extensions if I-140 approved but priority date not current (per-country backlog).
- Traps: once priority date current for **1 year** with no I-485 filed → further extensions barred; **I-140 must not be withdrawn within 180 days** of approval to preserve benefits.
- Timing: extension may be filed up to **6 months** before expiry; **240-day rule** allows work while a timely extension is pending.

### A.7 Green card: PERM → I-140 → I-485 / consular
- Sequence: PERM (DOL) → I-140 (USCIS) → I-485 adjustment or consular processing → LPR.
- Priority date = date USCIS received PERM (or I-140 where PERM-exempt); fixed across employer changes / porting.
- Visa Bulletin: two charts — **Final Action Dates** (approval) and **Dates for Filing** (submission); USCIS announces monthly which governs I-485 filing (e.g., July 2026 employment-based filings used Final Action Dates).
- Concurrent filing (I-140 + I-485 + I-765 EAD + I-131 AP) when priority date current.
- Pending I-485: renew EAD + AP continuously; AP prevents abandonment on travel; retrogression keeps I-485 pending without resetting priority date.
- Portability (§106(c)): once I-485 pending **180+ days** and I-140 approved → change to same-or-similar job, keep pending application.
- I-140 premium processing: **15 business days**.
- Backlogs are country-specific (India, China EB-2/EB-3): watch priority date vs. bulletin; alert within ~6 months of current.

### A.8 I-9 / E-Verify
- Section 1: by employee's first day (not before offer acceptance).
- Section 2: within **3 business days** of start; both sections by day one if employment < 3 days.
- Documents: one List A, or List B + List C; all **unexpired**; may not demand specific documents (anti-discrimination). Foreign passport + I-94 with valid endorsement = List A.
- E-Verify: case within **3 business days** of hire.
- Remote/alternative procedure: only for E-Verify employers in good standing (live video review, retain front/back copies, check the alternative-procedure box).
- Retention: **3 years after hire or 1 year after termination, whichever is later.**
- Receipt rule: 90 days to present a replacement for a lost/stolen/damaged document.
- Current form edition: 01/20/2025 (expiration 05/31/2027).

---

## Appendix B — Notification triggers catalog

For each, store a date type and a set of reminder offsets (e.g., 120/90/60/30/7 days), escalating employee → HR → counsel.

- I-94 expiry
- EAD start (unemployment-clock trigger) and EAD expiry
- OPT end date
- STEM validation dates (6/12/18/24 months)
- STEM EAD expiry + 180-day auto-extension boundary
- Cap-gap April 1 cutoff
- H-1B validity expiry + 6-month extension-filing window
- AC21 "one year to file I-485" clock (once priority date current)
- PERM validity (180 days to file I-140)
- Priority-date-approaching-current (within ~6 months)
- EAD/AP renewal during pending I-485
- Passport expiry
- I-9 Section 2 deadline + E-Verify 3-business-day deadline
- RFE response deadlines
- Offboarding → grace-period clock start (e.g., H-1B 60-day grace)

---

## Appendix C — Environment & setup

- Supabase project (Postgres + Auth + Storage + pgvector); enable RLS on all tables.
- Vercel project for `/apps/web`.
- Temporal (self-hosted or cloud) for the workflow engine — or configure a queue + cron alternative.
- Email provider API key (Resend/SES/SendGrid).
- LLM + embeddings provider keys for RAG.
- Secrets: never commit; use env vars. Enforce MFA on auth.

---

## Appendix D — Subagent prompt template

Use this shape for each `.claude/agents/*.md`:

```
---
name: <subagent-name>
description: <one line — when the orchestrator should delegate here>
tools: <minimum tools needed>
---
You own <domain> for the HR & Immigration Lifecycle Platform.

Constraints you must always follow:
- Enforce authorization server-side; never trust client-supplied scope.
- Immigration rules are versioned data (Appendix A), loaded confirmed_by_counsel=false;
  never hard-code immigration constants; route legal judgment to counsel.
- Sensitive PII (SSN, passport, I-9) is encrypted and all access is logged.
- Follow the referenced skill (frontend-design / mcp-builder / docx / pdf) for your area.

Your deliverables: <files/artifacts>.
Definition of done: <criteria from §13.4 relevant to this domain>.
Coordinate with: <other subagents>.
```

---

*End of specification. Build in the phase order in §13.3. Treat Appendix A as counsel-pending seed data.*
