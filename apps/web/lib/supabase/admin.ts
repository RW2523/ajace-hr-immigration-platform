/**
 * Service-role Supabase client (server-only, never sent to the browser). Used for
 * trusted operations that must bypass RLS at the Storage layer: minting signed
 * download URLs and performing server-side uploads after the app-layer
 * authorization check has already passed.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY. If absent, storage falls back to the
 * session-scoped client (which still works for a user's own org via bucket RLS).
 */
import 'server-only';
import { createClient } from '@supabase/supabase-js';

let _admin: ReturnType<typeof createClient> | null = null;

export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return null;
  if (!_admin) _admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  return _admin;
}

export const HR_DOCS_BUCKET = 'hr-documents';
