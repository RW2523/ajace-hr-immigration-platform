import { MfaChallenge } from '@/components/MfaChallenge';

// Auth page — must not prerender (the browser Supabase client needs runtime env).
export const dynamic = 'force-dynamic';

export default function LoginMfaPage() {
  return (
    <div className="auth-wrap">
      <div className="auth-brand">
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 20, letterSpacing: '-.02em' }}>Ajace</div>
        </div>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <h1 style={{ color: '#fff', fontSize: 30, lineHeight: 1.15, letterSpacing: '-.03em', maxWidth: 440 }}>
            One more step to keep your account safe.
          </h1>
          <p style={{ opacity: .9, fontSize: 15, maxWidth: 420, marginTop: 14, lineHeight: 1.6 }}>
            Enter the current 6-digit code from your authenticator app.
          </p>
        </div>
        <div style={{ position: 'relative', zIndex: 1, fontSize: 12.5, opacity: .8 }}>© Ajace · Status &amp; deadline tracker — not legal advice.</div>
      </div>
      <div className="auth-form-side">
        <div className="auth-card">
          <h2 style={{ fontSize: 24, letterSpacing: '-.02em' }}>Two-factor verification</h2>
          <p className="muted" style={{ fontSize: 13.5, marginTop: 4, marginBottom: 24 }}>Enter the code from your authenticator app.</p>
          <MfaChallenge />
        </div>
      </div>
    </div>
  );
}
