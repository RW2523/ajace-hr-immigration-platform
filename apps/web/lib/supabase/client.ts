'use client';
/**
 * Browser Supabase client (shares the SSR cookie storage with the server client).
 * Used for user-driven auth flows that must run client-side — notably MFA (TOTP)
 * enrollment and challenge, which need the browser to talk to the auth endpoint.
 */
import { createBrowserClient } from '@supabase/ssr';

export function supabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
