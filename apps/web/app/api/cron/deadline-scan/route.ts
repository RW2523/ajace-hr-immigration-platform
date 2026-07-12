/**
 * Scheduled deadline scan (§9, Phase 3 DoD). Invoked by Vercel Cron (see
 * /vercel.json) once daily; runs the notification engine for ALL orgs and returns
 * a summary. Guarded by a shared secret so only the scheduler can trigger it.
 *
 * Auth: send the secret as `Authorization: Bearer $CRON_SECRET` (Vercel Cron sets
 * this automatically) or an `x-cron-secret` header. If CRON_SECRET is unset the
 * route refuses to run (fail closed). Runs on the Node runtime (postgres driver).
 */
import { timingSafeEqual } from 'node:crypto';
import { serviceClient } from '@hr/db';
import { runScan } from '@hr/notifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Constant-time string compare to avoid leaking the secret via timing. */
function safeEqual(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function authorize(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed: never run unguarded
  const auth = req.headers.get('authorization');
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  return safeEqual(bearer, secret) || safeEqual(req.headers.get('x-cron-secret'), secret);
}

async function handle(req: Request): Promise<Response> {
  if (!process.env.CRON_SECRET) {
    console.error('[cron/deadline-scan] CRON_SECRET is not configured; refusing to run.');
    return Response.json({ ok: false, error: 'not configured' }, { status: 500 });
  }
  if (!authorize(req)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const sql = serviceClient();
  try {
    const today = new Date().toISOString().slice(0, 10);
    const report = await runScan(sql, today); // resolveChannels() picks provider vs. console by env
    return Response.json({ ok: true, today, ...report });
  } catch (e) {
    // Never leak internals/stack to the caller; log server-side.
    console.error('[cron/deadline-scan] scan failed:', e);
    return Response.json({ ok: false, error: 'scan failed' }, { status: 500 });
  } finally {
    await sql.end();
  }
}

export const GET = handle;
export const POST = handle;
