/**
 * The §14 "as-of / confirmed-by-counsel" indicator. Any value derived from the
 * immigration rules seed must render this until counsel ratifies the underlying
 * rule, so the product never presents an unratified value as a legal conclusion.
 */
export function CounselPendingBadge({ pending, asOf }: { pending: boolean; asOf?: string }) {
  if (!pending) {
    return (
      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12, background: '#0f2a17', color: '#57d98a', border: '1px solid #1c5232' }}>
        ✓ confirmed by counsel{asOf ? ` · as of ${asOf}` : ''}
      </span>
    );
  }
  return (
    <span
      title="This value comes from seed data and has not yet been ratified by the firm's immigration counsel. It is not legal advice."
      style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12, background: '#2a220f', color: '#e0c04a', border: '1px solid #52471c' }}
    >
      ⚠ pending counsel review{asOf ? ` · as of ${asOf}` : ''}
    </span>
  );
}
