import 'server-only';

/**
 * Lightweight in-memory sliding-window rate limiter.
 *
 * This protects a single server instance (and local dev) against bursts/abuse of
 * expensive endpoints (LLM calls, auth). On a multi-instance serverless deploy the
 * window is per-instance, which still meaningfully caps per-instance abuse; for a
 * hard global limit, back this with Vercel KV / Upstash Redis (swap `hit()` for a
 * Redis INCR+EXPIRE). Kept dependency-free on purpose.
 */
interface Bucket { count: number; resetAt: number }
const buckets = new Map<string, Bucket>();
let lastSweep = 0;

export interface RateResult { ok: boolean; remaining: number; resetInSeconds: number }

/**
 * Record a hit for `key`. Allows up to `limit` hits per `windowMs`.
 * Returns whether the request is allowed and how much budget remains.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateResult {
  const now = Date.now();
  // Opportunistic sweep of expired buckets to bound memory.
  if (now - lastSweep > windowMs) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    lastSweep = now;
  }
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, resetInSeconds: Math.ceil(windowMs / 1000) };
  }
  b.count += 1;
  const resetInSeconds = Math.max(0, Math.ceil((b.resetAt - now) / 1000));
  if (b.count > limit) return { ok: false, remaining: 0, resetInSeconds };
  return { ok: true, remaining: limit - b.count, resetInSeconds };
}

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}
