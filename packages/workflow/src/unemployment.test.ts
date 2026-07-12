/**
 * Pure unit tests for the OPT unemployment-day computation (Bug 5): a laid-off OPT
 * employee must show REAL accrued days from employment gaps, not a silent 0.
 */
import { describe, expect, it } from 'vitest';
import { unemploymentDaysFromIntervals } from './case-engine.js';

describe('unemploymentDaysFromIntervals (Bug 5)', () => {
  it('a laid-off employee accrues the post-layoff gap, not 0', () => {
    // OPT started 2026-01-01; employed through 2026-03-31; laid off; asOf 2026-04-30.
    const gap = unemploymentDaysFromIntervals(
      [{ start_date: '2026-01-01', end_date: '2026-03-31' }],
      '2026-01-01',
      '2026-04-30',
    );
    // Window 2026-01-01..2026-04-30 inclusive = 120 days; employed 90; unemployed 30.
    expect(gap).toBe(30);
  });

  it('continuously employed (open-ended placement) → 0 days', () => {
    const gap = unemploymentDaysFromIntervals(
      [{ start_date: '2026-01-01', end_date: null }],
      '2026-01-01',
      '2026-06-01',
    );
    expect(gap).toBe(0);
  });

  it('never employed on OPT → the whole window is unemployment', () => {
    const gap = unemploymentDaysFromIntervals([], '2026-01-01', '2026-01-31');
    expect(gap).toBe(31);
  });

  it('merges overlapping placements so overlap is not double-counted', () => {
    const gap = unemploymentDaysFromIntervals(
      [
        { start_date: '2026-01-01', end_date: '2026-02-15' },
        { start_date: '2026-02-01', end_date: '2026-03-01' }, // overlaps the first
      ],
      '2026-01-01',
      '2026-03-31',
    );
    // Employed 2026-01-01..2026-03-01 inclusive = 60 days; window = 90; unemployed 30.
    expect(gap).toBe(30);
  });

  it('clips placements starting before OPT to the OPT anchor', () => {
    const gap = unemploymentDaysFromIntervals(
      [{ start_date: '2025-06-01', end_date: '2026-01-31' }],
      '2026-01-01',
      '2026-02-28',
    );
    // Employed within window: 2026-01-01..2026-01-31 = 31 days; window = 59; unemployed 28.
    expect(gap).toBe(28);
  });
});
