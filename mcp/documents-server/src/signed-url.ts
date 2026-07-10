/**
 * Signed, time-limited URL issuance (§12). In production this delegates to Supabase
 * Storage `createSignedUrl(storageKey, expiresIn)`. Here we produce an HMAC-signed,
 * expiring token so the flow — and its expiry — is testable without a live bucket.
 * No public buckets; a URL is only ever minted after server-side authorization.
 */
import { createHmac } from 'node:crypto';

const DEFAULT_TTL_SECONDS = 300; // 5 minutes

function secret(): string {
  return process.env.SIGNED_URL_SECRET ?? process.env.PII_ENCRYPTION_KEY ?? 'dev-signing-secret';
}

export interface SignedUrl {
  url: string;
  expiresAt: string; // ISO
}

/** Mint a signed URL for a storage object, valid for `ttlSeconds`. */
export function signStorageUrl(storageKey: string, nowMs: number, ttlSeconds = DEFAULT_TTL_SECONDS): SignedUrl {
  const exp = Math.floor(nowMs / 1000) + ttlSeconds;
  const sig = createHmac('sha256', secret()).update(`${storageKey}:${exp}`).digest('hex').slice(0, 32);
  const base = process.env.STORAGE_BASE_URL ?? 'https://storage.example.supabase.co/object/sign';
  const url = `${base}/${encodeURIComponent(storageKey)}?exp=${exp}&sig=${sig}`;
  return { url, expiresAt: new Date(exp * 1000).toISOString() };
}

/** Validate a signed URL (used by the download proxy). */
export function verifyStorageUrl(storageKey: string, exp: number, sig: string, nowMs: number): boolean {
  if (Math.floor(nowMs / 1000) > exp) return false;
  const expected = createHmac('sha256', secret()).update(`${storageKey}:${exp}`).digest('hex').slice(0, 32);
  return expected === sig;
}
