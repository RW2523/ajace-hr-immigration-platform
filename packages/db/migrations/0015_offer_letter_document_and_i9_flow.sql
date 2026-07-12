-- 0015 — Make offer letters a real, viewable, signable document and give the I-9
-- flow the columns it needs to be completed through the product.
-- Fully idempotent: safe to re-run.

-- ── Offer letters: persist the rendered letter body + e-signature attribution ──
-- generateOfferLetter now renders deterministic HTML from the letter variables and
-- stores it here so the detail route can display the actual letter, and so the
-- signed artifact is reproducible. signer_user_id / sent_at capture the e-sign trail
-- alongside the pre-existing esign_status + signed_at columns.
alter table app.offer_letters add column if not exists rendered_html   text;
alter table app.offer_letters add column if not exists sent_at         timestamptz;
alter table app.offer_letters add column if not exists signer_user_id  uuid references app.users(id);

-- ── I-9: mark provenance of the deadline rows the HR module writes into
-- app.case_dates so the notification scan reminds on Section 2 / E-Verify, and so
-- re-opening an I-9 can idempotently replace its own derived dates without touching
-- immigration-domain dates. A partial unique index lets us upsert exactly one row
-- per (case, i9 date_type). Scoped to the two I-9 date_types only, so it never
-- constrains the immigration domain's own case_dates rows.
create unique index if not exists case_dates_i9_unique
  on app.case_dates (case_id, date_type)
  where date_type in ('i9_section2_deadline', 'everify_case_deadline');
