# Immigration Seed Data

Machine-readable seed data for the HR & Immigration Lifecycle Platform (see `../../BUILD_SPEC.md`, §7.5 and Appendix A/B). Compiled **2026-07-06** by Claude (Fable 5) via multi-agent web research against official sources (USCIS, ICE/SEVP, DOL/OFLC, State Department, Federal Register, eCFR), with a second adversarial verification pass per file and a completeness audit against the spec's appendices.

> **⚠️ Counsel-pending.** Every row is loaded with `confirmed_by_counsel: false`. Per BUILD_SPEC §0(4) and §14, none of these values may drive a user-facing decision until the firm's immigration counsel ratifies it. This data is not legal advice.

## Files

| File | Contents | Loads into |
|---|---|---|
| `statuses.json` | Work-authorization status taxonomy (§7.1) incl. green-card overlay + `l1`/`o1`/`tn` placeholders | `statuses` |
| `transitions.json` | The full state machine (§7.2) + §7.4 edge branches (cap-gap, RFE/denial, grace clocks…) | `case_transitions` config / rules-engine |
| `document_requirements.json` | Adaptive-intake document slots per status/transition (§7.3) + placement compliance docs (§7.6) | `document_requirements` |
| `notification_triggers.json` | Full Appendix B trigger catalog: date types, offsets, escalation tiers, channels | notification engine config |
| `rules_f1.json` | CPT / OPT / STEM OPT rules (durations, windows, unemployment clocks, reporting) | `rules` |
| `rules_capgap.json` | Cap-gap rules incl. the Jan 17, 2025 modernization-rule April 1 change | `rules` |
| `rules_h1b_cap.json` | Cap, FY2027 registration, selection methodology, $100k proclamation fee, employer fees | `rules` |
| `rules_h1b_mobility.json` | Portability, amendments (Simeio), 6-year max, AC21 §104(c)/§106(a), 240-day rule | `rules` |
| `rules_greencard.json` | PERM → I-140 → I-485/consular, priority dates, concurrent filing, §106(c) portability | `rules` |
| `visa_bulletin_current.json` | July 2026 Visa Bulletin snapshot (Final Action + Dates for Filing, EB × country) + USCIS chart designation | `priority_date_tracking` reference |
| `rules_i9_everify.json` | I-9 / E-Verify deadlines, document lists, remote procedure, retention, form edition | `rules` |
| `uscis_fees.json` | Current G-1055 fee table + H-1B-specific fees + premium processing | `rules` |
| `processing_times.json` | **Volatile snapshot** of USCIS/DOL processing times (operational defaults, not rules) | reference only |

## Row format (`rules_*.json`, `uscis_fees.json`)

```json
{
  "rule_id": "opt-unemployment-limit-days",
  "status_or_transition_key": "f1_opt",
  "attribute": "unemployment_limit_days",
  "value": 90,
  "value_type": "count_days",
  "effective_date": "2008-04-08",
  "source_url": "https://…",
  "source_citation": "8 CFR 214.2(f)(10)(ii)(E)",
  "confirmed_by_counsel": false,
  "superseded_by": null,
  "last_verified": "2026-07-06",
  "notes": "…"
}
```

Conventions:
- **Versioning:** a law/fee change is a **new row**; the old row's `superseded_by` points at the new `rule_id`. The loader must preserve superseded rows (history matters for cases filed under old rules).
- **`UNVERIFIED:`** prefix in `notes` marks values the verifier could not confirm from an official primary source — prioritize these for counsel review.
- **`last_verified`** is when a web verification pass last confirmed the value — distinct from `effective_date`.
- **`value_type: "business_days"`** marks durations denominated in business days (or federal government working days, noted per row) so the validator cannot misread them as calendar days; `count_days` / `window_days` are always calendar days.
- **`status_or_transition_key: "all"`** (used by `rules_i9_everify.json`) is a sentinel meaning the rule applies to every status — the loader/validator must special-case it rather than resolve it as a foreign key against `statuses.json`/`transitions.json`.
- **Fee `effective_date`** is the first date the amount actually applied to the transaction type (e.g. the $215 H-1B registration fee uses 2025-03-07, the FY2026 registration-period opening, not the 2024-04-01 fee-rule effective date, which is kept in `notes`/`source_citation`).
- **`rule_ref`** values in `transitions.json` preconditions are foreign keys to `rule_id` in the `rules_*.json`/`uscis_fees.json` files.

## Refresh procedure

1. Re-run the research workflow (script saved in the session workflow directory; or re-prompt Claude Code: "refresh data/immigration-seed against current official sources").
2. `visa_bulletin_current.json` must be refreshed **monthly** (bulletin cycle); `processing_times.json` monthly; fee/rule files on any USCIS/DOL/DOS announcement and at least quarterly.
3. Counsel review flips `confirmed_by_counsel` to `true` per row **in the database** (the JSON stays `false`; ratification is an audited DB operation, not a file edit).
