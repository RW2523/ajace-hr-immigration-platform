import postgres from 'postgres';

/**
 * Serverless-safe Postgres connection factory.
 *
 * On Vercel (and any serverless host) each function instance gets its own pool, so
 * a large `max` exhausts Postgres connections fast. The correct production setup is
 * Supabase's TRANSACTION pooler (pgbouncer, port 6543), which does NOT support
 * prepared statements — so `prepare` must be disabled when talking to it.
 *
 * We detect a pooler by port 6543, a `pooler.` host, or an explicit DB_POOLER=1,
 * and size the pool for the environment. Direct (non-pooler) connections keep
 * prepared statements and a small pool.
 */
const LOCAL_DEFAULT = 'postgres://postgres:postgres@localhost:54329/hr';

export function resolveDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url) return url;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL is required in production (never fall back to localhost).');
  }
  return LOCAL_DEFAULT;
}

function isPooler(url: string): boolean {
  if (process.env.DB_POOLER === '1') return true;
  try {
    const u = new URL(url);
    return u.port === '6543' || u.hostname.includes('pooler.');
  } catch {
    return false;
  }
}

export interface ConnectOptions {
  /** Pool size. Defaults: 1 on a pooler/serverless, 4 otherwise. */
  max?: number;
}

export function createSql(opts: ConnectOptions = {}): postgres.Sql {
  const url = resolveDatabaseUrl();
  const pooled = isPooler(url);
  const serverless = Boolean(process.env.VERCEL) || pooled;
  return postgres(url, {
    max: opts.max ?? (serverless ? 1 : 4),
    prepare: !pooled, // pgbouncer transaction mode can't use prepared statements
    idle_timeout: serverless ? 20 : undefined,
    connect_timeout: 10,
    onnotice: () => {},
  });
}
