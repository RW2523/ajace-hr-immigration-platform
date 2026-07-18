/**
 * Refreshes the Supabase auth session on every request and redirects
 * unauthenticated users to /login for protected routes. Keeping the session fresh
 * server-side is required for `supabase.auth.getUser()` to work in Server Components.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const PUBLIC_PATHS = ['/login', '/'];

/**
 * Per-request Content-Security-Policy with a fresh nonce. Next injects the nonce
 * into its own scripts, so `script-src` can drop 'unsafe-inline' in production
 * (strict-dynamic). Dev needs 'unsafe-eval' for Fast Refresh and must NOT set
 * frame-ancestors so the local preview can embed the app. style-src keeps
 * 'unsafe-inline' because the UI uses React inline style attributes.
 */
function buildCsp(nonce: string): string {
  const isProd = process.env.NODE_ENV === 'production';
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const supaHost = supabase.replace(/^https?:\/\//, '');
  const script = isProd
    ? `'self' 'nonce-${nonce}' 'strict-dynamic'`
    : `'self' 'unsafe-eval' 'unsafe-inline'`;
  const directives = [
    `default-src 'self'`,
    `script-src ${script}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:${supaHost ? ' https://' + supaHost : ''}`,
    `font-src 'self' data:`,
    `connect-src 'self'${supabase ? ' ' + supabase + ' wss://' + supaHost : ''}`,
    `frame-src 'self'${supabase ? ' ' + supabase : ''}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    ...(isProd ? [`frame-ancestors 'none'`, `upgrade-insecure-requests`] : []),
  ];
  return directives.join('; ');
}

export async function middleware(request: NextRequest) {
  // Nonce for this request; passed to Next via the request headers so it stamps
  // the CSP nonce onto its inline bootstrap scripts.
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);

  let response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('content-security-policy', csp);

  // Share the session cookie across *.ajace.com subdomains for SSO (set in prod only).
  const cookieDomain = process.env.NEXT_PUBLIC_COOKIE_DOMAIN;
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      ...(cookieDomain ? { cookieOptions: { domain: cookieDomain } } : {}),
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet: { name: string; value: string; options?: Record<string, unknown> }[]) => {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          // Recreate the response but PRESERVE the CSP request headers + header.
          response = NextResponse.next({ request: { headers: requestHeaders } });
          response.headers.set('content-security-policy', csp);
          for (const { name, value, options } of toSet) response.cookies.set(name, value, options as never);
        },
      },
    },
  );

  const { data } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  // API routes enforce their OWN auth (assistant checks the principal, cron checks
  // a secret, health is public) and must return JSON — never an HTML login redirect.
  const isApi = path.startsWith('/api/');
  const isPublic = isApi || PUBLIC_PATHS.includes(path) || path.startsWith('/_next') || path.startsWith('/favicon');

  if (!data.user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    const redirect = NextResponse.redirect(url);
    redirect.headers.set('content-security-policy', csp);
    return redirect;
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
