import { describe, expect, it } from 'vitest';
import { decryptPII, encryptPII, generateKey, isEncrypted } from './encryption.js';

const KEY = Buffer.from(generateKey(), 'base64');

describe('PII encryption (AES-256-GCM)', () => {
  it('round-trips a value', () => {
    const ct = encryptPII('123-45-6789', KEY);
    expect(ct).not.toContain('123-45-6789');
    expect(isEncrypted(ct)).toBe(true);
    expect(decryptPII(ct, KEY)).toBe('123-45-6789');
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const a = encryptPII('same', KEY);
    const b = encryptPII('same', KEY);
    expect(a).not.toBe(b);
    expect(decryptPII(a, KEY)).toBe(decryptPII(b, KEY));
  });

  it('fails to decrypt with the wrong key (auth tag)', () => {
    const ct = encryptPII('secret', KEY);
    const wrong = Buffer.from(generateKey(), 'base64');
    expect(() => decryptPII(ct, wrong)).toThrow();
  });

  it('detects tampering (GCM authentication)', () => {
    const ct = encryptPII('secret', KEY);
    const parts = ct.split('.');
    // flip a byte in the ciphertext
    const bytes = Buffer.from(parts[2]!, 'base64');
    bytes[0] = bytes[0]! ^ 0xff;
    parts[2] = bytes.toString('base64');
    expect(() => decryptPII(parts.join('.'), KEY)).toThrow();
  });

  it('rejects malformed envelopes', () => {
    expect(() => decryptPII('not-an-envelope', KEY)).toThrow();
    expect(isEncrypted('plaintext ssn')).toBe(false);
  });

  it('rejects keys of the wrong length', () => {
    expect(() => encryptPII('x', Buffer.alloc(16))).toThrow();
  });
});
