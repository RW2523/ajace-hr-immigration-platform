import postgres from 'postgres';

/**
 * Serverless-safe Postgres connection factory.
 *
 * The correct production setup is Supabase's TRANSACTION pooler (pgbouncer,
 * port 6543), which does NOT support prepared statements — so `prepare` must be
 * disabled when talking to it.
 *
 * POOL SIZE matters: postgres.js pipelines every in-flight query onto a single
 * connection. When a request runs concurrent queries (e.g. a Server Component's
 * `Promise.all([...])`) with `max: 1`, those pipelined queries hit pgbouncer's
 * transaction mode, which cannot demultiplex a pipeline and HANGS the request
 * until the platform timeout (a 504). The pooler is built to multiplex many
 * client connections, so giving concurrent queries their own connections via a
 * small pool (>1) is both safe and required. Direct (non-pooler) connections keep
 * prepared statements and a small pool.
 *
 * We detect a pooler by port 6543, a `pooler.` host, or an explicit DB_POOLER=1.
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
  /** Pool size. Defaults: 5 on a pooler (concurrent queries need their own conn), 4 otherwise. */
  max?: number;
}

export function createSql(opts: ConnectOptions = {}): postgres.Sql {
  const url = resolveDatabaseUrl();
  const pooled = isPooler(url);
  const serverless = Boolean(process.env.VERCEL) || pooled;
  // A pooler MUST allow >1 so concurrent (pipelined) queries each get a connection;
  // max:1 there deadlocks pgbouncer. Direct connections keep a small fixed pool.
  const defaultMax = pooled ? 5 : 4;
  return postgres(url, {
    max: opts.max ?? defaultMax,
    prepare: !pooled, // pgbouncer transaction mode can't use prepared statements
    idle_timeout: serverless ? 20 : undefined,
    connect_timeout: 10,
    onnotice: () => {},
  });
}
