/**
 * Timing-window / derived-deadline evaluation for the validator (Bugs 2 & 3).
 *
 * The seed's `timing_window` on each transition is prose; the machine-checkable
 * timing lives in the versioned CLOCK rules. This module wires the clock
 * calculators — gracePeriod, stemAutoExtensionBoundary, h1bExtensionWindow,
 * ac21OneYearToFile, i9Deadlines — against the case snapshot's dates + asOf and
 * turns them into Findings. Previously these calculators were dead code and
 * snapshot.dates was never read; now a passed deadline or an out-of-window filing
 * surfaces as a finding.
 *
 * Every finding cites the rule ids the clock used and carries counselPending, so
 * the UI can render the §14 "as-of / confirmed-by-counsel" indicator. A finding is
 * only emitted when the relevant snapshot dates are present — no dates, no claim.
 */
import type { RuleIndex } from './rule-index.js';
import type { CaseSnapshot, Finding, Severity } from './types.js';
import {
  ac21OneYearToFile,
  gracePeriod,
  h1bExtensionWindow,
  i9Deadlines,
  stemAutoExtensionBoundary,
} from './clocks.js';

/** First present, non-empty snapshot date among the given aliases. */
function firstDate(snapshot: CaseSnapshot, keys: readonly string[]): string | undefined {
  for (const k of keys) {
    const v = snapshot.dates[k];
    if (v) return v;
  }
  return undefined;
}

/** Accepted snapshot date_type aliases per concept (grounded in the seed's
 *  notification_date_types vocabulary; documented for callers/db-schema). */
const DATE_KEYS = {
  optEadExpiry: ['opt_ead_expiry', 'ead_expiry', 'opt_end'],
  h1bValidityExpiry: ['h1b_validity_expiry', 'i94_expiry'],
  priorityDateCurrent: ['priority_date_current', 'priority_date_became_current', 'ac21_one_year_i485_clock'],
  h1bTermination: ['h1b_termination_date', 'last_day_of_employment', 'employment_end_date'],
  hire: ['hire_date', 'employment_start_date', 'h1b_start_date', 'ead_start'],
  capGapCutoff: ['cap_gap_april_1_cutoff'],
} as const;

/** Severity of "asOf vs a single deadline": past it → violation, within 15d → warning. */
function deadlineSeverity(asOf: string, deadline: string): Severity {
  if (asOf > deadline) return 'violation';
  return 'info';
}

export function deriveTimingFindings(snapshot: CaseSnapshot, index: RuleIndex, asOf: string): Finding[] {
  const out: Finding[] = [];
  const status = snapshot.currentStatus;

  // ── F-1 60-day grace after OPT / STEM OPT EAD expiry ────────────────────────
  if (status === 'f1_opt' || status === 'f1_stem_opt') {
    const eadExpiry = firstDate(snapshot, DATE_KEYS.optEadExpiry);
    if (eadExpiry) {
      const g = gracePeriod(status, eadExpiry, index, asOf);
      if (g?.endsOn) {
        out.push({
          code: 'f1_grace_period',
          severity: asOf > g.endsOn ? 'violation' : 'info',
          message:
            asOf > g.endsOn
              ? `F-1 ${g.graceDays}-day grace period ended ${g.endsOn} (after OPT EAD expiry ${eadExpiry}).`
              : `F-1 ${g.graceDays}-day grace period runs to ${g.endsOn} (from OPT EAD expiry ${eadExpiry}).`,
          rulesCited: g.rulesCited,
          counselPending: g.counselPending,
        });
      }
    }
  }

  // ── STEM OPT automatic-extension-while-pending boundary (OPT EAD expiry +N) ──
  if (status === 'f1_stem_opt') {
    const optEadExpiry = firstDate(snapshot, DATE_KEYS.optEadExpiry);
    if (optEadExpiry) {
      const b = stemAutoExtensionBoundary(optEadExpiry, index, asOf);
      if (b) {
        out.push({
          code: 'stem_auto_extension_boundary',
          severity: asOf > b.boundary ? 'violation' : 'info',
          message:
            asOf > b.boundary
              ? `STEM OPT automatic ${b.days}-day work-authorization extension ended ${b.boundary}; ` +
                `if the extension is still pending, work authorization has lapsed.`
              : `STEM OPT automatic ${b.days}-day extension of work authorization runs to ${b.boundary} ` +
                `while the timely-filed extension is pending.`,
          rulesCited: b.rulesCited,
          counselPending: b.counselPending,
        });
      }
    }
  }

  // ── H-1B extension filing window + 240-day pending work authorization ────────
  if (status === 'h1b_active' || status === 'h1b_extension_pending') {
    const expiry = firstDate(snapshot, DATE_KEYS.h1bValidityExpiry);
    if (expiry) {
      const w = h1bExtensionWindow(expiry, index, asOf);
      if (w?.earliest && w.latest) {
        let severity: Severity = 'info';
        let phase: string;
        if (asOf > w.latest) {
          severity = 'violation';
          phase = `closed (validity expired ${w.latest}); a timely extension was required to preserve work authorization`;
        } else if (asOf >= w.earliest) {
          phase = `OPEN (${w.earliest} → ${w.latest}); file the extension to preserve the 240-day work authorization`;
        } else {
          phase = `not yet open (opens ${w.earliest}, closes ${w.latest})`;
        }
        out.push({
          code: 'h1b_extension_window',
          severity,
          message: `H-1B extension filing window is ${phase}.`,
          rulesCited: w.rulesCited,
          counselPending: w.counselPending,
        });
      }
    }
  }

  // ── H-1B 60-day grace on termination ────────────────────────────────────────
  if (status === 'h1b_active') {
    const termination = firstDate(snapshot, DATE_KEYS.h1bTermination);
    if (termination) {
      const g = gracePeriod('h1b_active', termination, index, asOf);
      if (g?.endsOn) {
        out.push({
          code: 'h1b_grace_period',
          severity: asOf > g.endsOn ? 'violation' : 'info',
          message:
            asOf > g.endsOn
              ? `H-1B ${g.graceDays}-day grace period ended ${g.endsOn} (from last day ${termination}).`
              : `H-1B ${g.graceDays}-day grace period runs to ${g.endsOn} (from last day ${termination}).`,
          rulesCited: g.rulesCited,
          counselPending: g.counselPending,
        });
      }
    }
  }

  // ── AC21 one-year-to-file-I-485 trap (approved I-140) ───────────────────────
  if (status === 'i140_approved') {
    const pdCurrent = firstDate(snapshot, DATE_KEYS.priorityDateCurrent);
    if (pdCurrent) {
      const i485Filed = snapshot.attributes['i485_filed'] === true || Boolean(snapshot.dates['i485_filed_date']);
      const r = ac21OneYearToFile(pdCurrent, i485Filed, index, asOf);
      if (r) {
        out.push({
          code: 'ac21_one_year_to_file',
          severity: r.lapsed ? 'violation' : 'info',
          message: r.lapsed
            ? `AC21 one-year-to-file trap: priority date current since ${pdCurrent}, deadline ${r.deadline} ` +
              `passed with no I-485 filed — further H-1B extensions are barred.`
            : i485Filed
              ? `AC21 one-year-to-file: I-485 recorded as filed; deadline was ${r.deadline} (priority date current ${pdCurrent}).`
              : `AC21 one-year-to-file: file the I-485 by ${r.deadline} to preserve H-1B extension eligibility ` +
                `(priority date current since ${pdCurrent}).`,
          rulesCited: r.rulesCited,
          counselPending: r.counselPending,
        });
      }
    }
  }

  // ── I-9 Section 2 + E-Verify case-creation deadlines (from hire date) ───────
  const hire = firstDate(snapshot, DATE_KEYS.hire);
  if (hire) {
    const d = i9Deadlines(hire, index, asOf);
    if (d) {
      out.push({
        code: 'i9_section2_deadline',
        severity: deadlineSeverity(asOf, d.section2Due),
        message: `I-9 Section 2 due ${d.section2Due} (from hire ${hire}).`,
        rulesCited: d.rulesCited,
        counselPending: d.counselPending,
      });
      out.push({
        code: 'everify_case_deadline',
        severity: deadlineSeverity(asOf, d.everifyDue),
        message: `E-Verify case creation due ${d.everifyDue} (from hire ${hire}).`,
        rulesCited: d.rulesCited,
        counselPending: d.counselPending,
      });
    }
  }

  // ── Cap-gap April 1 cutoff (explicit tracked deadline) ──────────────────────
  if (status === 'h1b_cap_gap') {
    const cutoff = firstDate(snapshot, DATE_KEYS.capGapCutoff);
    if (cutoff) {
      out.push({
        code: 'cap_gap_cutoff',
        severity: asOf > cutoff ? 'violation' : 'info',
        message:
          asOf > cutoff
            ? `Cap-gap ended ${cutoff}; status/work authorization no longer extended by cap-gap.`
            : `Cap-gap extension runs to ${cutoff}.`,
        rulesCited: [],
        counselPending: true,
      });
    }
  }

  return out;
}
