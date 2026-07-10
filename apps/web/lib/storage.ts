/**
 * Real Supabase Storage for HR/immigration documents (§12). Private bucket,
 * signed time-limited URLs ONLY, org-scoped object paths ({org_id}/{employee}/...).
 * Authorization is enforced in the app layer BEFORE any URL is minted or upload
 * accepted; the storage-object RLS policy is the defense-in-depth backstop.
 */
import 'server-only';
import { HR_DOCS_BUCKET, supabaseAdmin } from './supabase/admin';
import { supabaseStorage } from './supabase/server';

/** Build the canonical object path for a document. */
export function documentPath(orgId: string, employeeId: string, documentType: string, filename: string): string {
  const safe = filename.replace(/[^\w.\-]/g, '_');
  return `${orgId}/${employeeId}/${documentType}/${Date.now()}_${safe}`;
}

async function storage() {
  // Prefer the service-role client for reliable signing/upload after app authz;
  // fall back to the session client (bucket RLS still scopes to the caller's org).
  const admin = supabaseAdmin();
  return admin ? admin.storage : await supabaseStorage();
}

/** Mint a signed, time-limited download URL for a stored object. */
export async function signedDownloadUrl(storageKey: string, expiresInSeconds = 300): Promise<string | null> {
  const s = await storage();
  const { data, error } = await s.from(HR_DOCS_BUCKET).createSignedUrl(storageKey, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}

/** Mint a signed upload URL the browser can PUT to directly. */
export async function signedUploadUrl(storageKey: string): Promise<{ url: string; token: string } | null> {
  const s = await storage();
  const { data, error } = await s.from(HR_DOCS_BUCKET).createSignedUploadUrl(storageKey);
  if (error || !data) return null;
  return { url: data.signedUrl, token: data.token };
}

/** Server-side upload of file bytes (after app-layer authorization). */
export async function uploadDocument(storageKey: string, bytes: ArrayBuffer, contentType: string): Promise<boolean> {
  const s = await storage();
  const { error } = await s.from(HR_DOCS_BUCKET).upload(storageKey, bytes, { contentType, upsert: false });
  return !error;
}
