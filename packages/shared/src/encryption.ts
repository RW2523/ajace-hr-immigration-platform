/**
 * Application-layer encryption for sensitive PII columns (SSN, W-4, passport) — §12.
 *
 * This is *in addition to* Postgres at-rest encryption: it means a database dump
 * or a compromised read-replica does not expose SSNs without the app key.
 *
 * AES-256-GCM (authenticated). Envelope format (base64):
 *   v1.<iv_b64>.<ciphertext_b64>.<authTag_b64>
 * The version prefix allows key rotation / algorithm changes without ambiguity.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12; // GCM standard nonce length
const VERSION = 'v1';

function loadKey(explicit?: Buffer): Buffer {
  if (explicit) {
    if (explicit.length !== 32) throw new Error('PII key must be 32 bytes');
    return explicit;
  }
  const b64 = process.env.PII_ENCRYPTION_KEY;
  if (!b64) throw new Error('PII_ENCRYPTION_KEY is not set');
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) throw new Error('PII_ENCRYPTION_KEY must decode to 32 bytes (base64 of 32 random bytes)');
  return key;
}

/** Encrypt a UTF-8 string. Returns the versioned base64 envelope. */
export function encryptPII(plaintext: string, key?: Buffer): string {
  const k = loadKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, k, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), ct.toString('base64'), tag.toString('base64')].join('.');
}

/** Decrypt a versioned base64 envelope back to the UTF-8 string. */
export function decryptPII(envelope: string, key?: Buffer): string {
  const k = loadKey(key);
  const parts = envelope.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Malformed or unsupported PII envelope');
  }
  const [, ivB64, ctB64, tagB64] = parts;
  const iv = Buffer.from(ivB64!, 'base64');
  const ct = Buffer.from(ctB64!, 'base64');
  const tag = Buffer.from(tagB64!, 'base64');
  const decipher = createDecipheriv(ALGO, k, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** True if the value looks like an encrypted envelope (not plaintext). */
export function isEncrypted(value: string): boolean {
  return value.startsWith(`${VERSION}.`) && value.split('.').length === 4;
}

/** Generate a fresh 32-byte key as base64 (for `.env`). */
export function generateKey(): string {
  return randomBytes(32).toString('base64');
}
