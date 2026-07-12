/**
 * Liveness/readiness probe. Returns 200 with a DB round-trip check, 503 if the
 * database is unreachable. No auth, no data — safe to expose to uptime monitors.
 */
import { db } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [row] = await db()<{ ok: number }[]>`select 1 as ok`;
    return Response.json({ status: 'ok', db: row?.ok === 1 }, { status: 200 });
  } catch {
    return Response.json({ status: 'degraded', db: false }, { status: 503 });
  }
}
