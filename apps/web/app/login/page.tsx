import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { Scale, ShieldCheck, Sparkles, CalendarClock } from 'lucide-react';
import { supabaseServer } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rate-limit';

async function signIn(formData: FormData) {
  'use server';
  // Brute-force guard: cap sign-in attempts per client IP (layered on top of
  // Supabase Auth's own rate limiting).
  const h = await headers();
  const ip = (h.get('x-forwarded-for')?.split(',')[0] ?? h.get('x-real-ip') ?? 'unknown').trim();
  if (!rateLimit(`login:${ip}`, 10, 5 * 60_000).ok) {
    redirect(`/login?error=${encodeURIComponent('Too many attempts. Please wait a few minutes and try again.')}`);
  }
  const email = String(formData.get('email') ?? '').slice(0, 320);
  const password = String(formData.get('password') ?? '').slice(0, 200);
  if (!email || !password) redirect(`/login?error=${encodeURIComponent('Email and password are required.')}`);
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  // If the account has verified MFA, the password step only reaches aal1; require
  // a one-time code to step up to aal2 before entering the workspace.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === 'aal2' && aal.nextLevel !== aal.currentLevel) redirect('/login/mfa');
  redirect('/dashboard');
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="auth-wrap">
      <div className="auth-brand">
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div className="row" style={{ gap: 11 }}>
            <div style={{ width: 40, height: 40, borderRadius: 11, background: 'rgba(255,255,255,.18)', display: 'grid', placeItems: 'center' }}><Scale size={22} /></div>
            <div style={{ fontWeight: 800, fontSize: 20, letterSpacing: '-.02em' }}>Ajace</div>
          </div>
        </div>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <h1 style={{ color: '#fff', fontSize: 32, lineHeight: 1.15, letterSpacing: '-.03em', maxWidth: 440 }}>
            Immigration &amp; HR, handled with clarity.
          </h1>
          <p style={{ opacity: .9, fontSize: 15, maxWidth: 420, marginTop: 14, lineHeight: 1.6 }}>
            One workspace for your case status, deadlines, and documents — with an assistant that answers only from your own records.
          </p>
          <div style={{ display: 'grid', gap: 14, marginTop: 28, maxWidth: 400 }}>
            {[
              { icon: <ShieldCheck size={18} />, t: 'Bank-grade access controls', d: 'You only ever see your own data.' },
              { icon: <CalendarClock size={18} />, t: 'Never miss a deadline', d: 'Every immigration date, tracked and escalated.' },
              { icon: <Sparkles size={18} />, t: 'A guide, not legal advice', d: 'Legal questions route to your counsel.' },
            ].map((f, i) => (
              <div key={i} className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
                <div style={{ width: 34, height: 34, borderRadius: 9, background: 'rgba(255,255,255,.16)', display: 'grid', placeItems: 'center', flex: '0 0 34px' }}>{f.icon}</div>
                <div><div style={{ fontWeight: 700, fontSize: 14 }}>{f.t}</div><div style={{ opacity: .85, fontSize: 13 }}>{f.d}</div></div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ position: 'relative', zIndex: 1, fontSize: 12.5, opacity: .8 }}>© Ajace · Status &amp; deadline tracker — not legal advice.</div>
      </div>

      <div className="auth-form-side">
        <div className="auth-card">
          <h2 style={{ fontSize: 24, letterSpacing: '-.02em' }}>Welcome back</h2>
          <p className="muted" style={{ fontSize: 13.5, marginTop: 4, marginBottom: 24 }}>Sign in to your workspace.</p>
          {error && <div className="callout callout-warn" style={{ marginBottom: 16 }}><div>{error}</div></div>}
          <form action={signIn} style={{ display: 'grid', gap: 14 }}>
            <div>
              <label className="input-label">Email</label>
              <input name="email" type="email" className="input" placeholder="you@company.com" required />
            </div>
            <div>
              <label className="input-label">Password</label>
              <input name="password" type="password" className="input" placeholder="••••••••" required />
            </div>
            <button type="submit" className="btn btn-primary" style={{ padding: '11px 16px', marginTop: 4 }}>Sign in</button>
          </form>
          {process.env.NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS === '1' && (
          <details style={{ marginTop: 20 }}>
            <summary style={{ cursor: 'pointer', color: 'var(--muted)', fontSize: 12.5, fontWeight: 600 }}>Demo accounts — AJACE Inc</summary>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 10, lineHeight: 1.85 }}>
              <div style={{ fontWeight: 700, color: 'var(--ink-2)', marginTop: 4 }}>Admin (full access)</div>
              <div><code>admin@ajace.com</code> · AJACE Admin</div>
              <div style={{ fontWeight: 700, color: 'var(--ink-2)', marginTop: 8 }}>Employer</div>
              <div><code>johan@ajace.com</code> · Johan</div>
              <div><code>anita@ajace.com</code> · Anita</div>
              <div style={{ fontWeight: 700, color: 'var(--ink-2)', marginTop: 8 }}>HR</div>
              <div><code>subashini@ajace.com</code> · Subashini</div>
              <div><code>sheryl@ajace.com</code> · Sheryl</div>
              <div style={{ fontWeight: 700, color: 'var(--ink-2)', marginTop: 8 }}>Employee</div>
              <div><code>richard@ajace.com</code> · Richard</div>
              <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border-2)' }}>Password for all: <code>Ajace@2026</code></div>
            </div>
          </details>
          )}
        </div>
      </div>
    </div>
  );
}
