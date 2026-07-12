import { describe, expect, it } from 'vitest';
import { documentPath } from './storage';

const ORG = '11111111-1111-1111-1111-111111111111';
const EMP = '22222222-2222-2222-2222-222222222222';

describe('documentPath (storage key construction)', () => {
  it('is scoped under {org}/{employee}/{type}/', () => {
    const key = documentPath(ORG, EMP, 'passport', 'my passport.pdf');
    expect(key.startsWith(`${ORG}/${EMP}/passport/`)).toBe(true);
  });

  it('sanitizes the filename so it cannot escape the tenant prefix (no traversal)', () => {
    const key = documentPath(ORG, EMP, 'passport', '../../../etc/passwd');
    // The object stays under the caller's org/employee/type prefix...
    expect(key.startsWith(`${ORG}/${EMP}/passport/`)).toBe(true);
    // ...and every path SEPARATOR from the input is stripped, so a "../../" style
    // filename cannot climb out of that prefix (the real traversal defense).
    const tail = key.slice(`${ORG}/${EMP}/passport/`.length);
    expect(tail).not.toContain('/');
    expect(tail).not.toContain('\\');
  });

  it('strips spaces and unusual characters from the filename', () => {
    const key = documentPath(ORG, EMP, 'ead_card', 'EAD (2026)!.pdf');
    const tail = key.slice(`${ORG}/${EMP}/ead_card/`.length);
    expect(tail).toMatch(/^\d+_[\w.\-]+$/);
  });
});
