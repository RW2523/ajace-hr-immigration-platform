'use client';
// Segment error boundary for the authenticated app. Keeps the shell, shows a safe
// message (never the underlying error/stack), and offers a retry.
import { Card } from '@/components/ui';

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div>
      <div className="page-head"><div className="page-title">Something went wrong</div></div>
      <Card>
        <div className="muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
          We hit an unexpected error loading this page. Please try again — if it keeps happening, contact your administrator.
        </div>
        <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={reset}>Try again</button>
      </Card>
    </div>
  );
}
