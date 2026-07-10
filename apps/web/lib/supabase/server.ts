/**
 * Supabase server client (@supabase/ssr) for real Auth. Reads/writes the session
 * cookies so `supabase.auth.getUser()` returns the verified user server-side. The
 * user id it yields is the SAME uuid as app.users.id (and auth.uid() in RLS).
 */
import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function supabaseServer() {
  const jar = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createServerClient(url, key, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (toSet: { name: string; value: string; options?: Record<string, unknown> }[]) => {
        try {
          for (const { name, value, options } of toSet) jar.set(name, value, options as never);
        } catch {
          // called from a Server Component render — safe to ignore; middleware refreshes.
        }
      },
    },
  });
}

/** Storage client bound to the current session (for signed URLs / uploads). */
export async function supabaseStorage(): Promise<SupabaseClient['storage']> {
  const client = await supabaseServer();
  return client.storage;
}
