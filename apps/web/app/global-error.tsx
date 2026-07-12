'use client';
// Root error boundary. Renders a minimal, non-leaky page (no stack traces to the
// user) and its own <html>/<body> because it replaces the root layout on error.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', display: 'grid', placeItems: 'center', minHeight: '100vh', margin: 0, background: '#f5f6fa', color: '#1e2233' }}>
        <div style={{ textAlign: 'center', padding: 24, maxWidth: 420 }}>
          <div style={{ fontSize: 40 }}>⚠️</div>
          <h1 style={{ fontSize: 20, margin: '12px 0 6px' }}>Something went wrong</h1>
          <p style={{ color: '#5b627a', fontSize: 14, lineHeight: 1.6 }}>
            An unexpected error occurred. Our team has been notified. Please try again.
          </p>
          <button
            onClick={reset}
            style={{ marginTop: 16, padding: '10px 18px', borderRadius: 10, border: 0, background: '#5b5bd6', color: '#fff', fontWeight: 600, cursor: 'pointer' }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
