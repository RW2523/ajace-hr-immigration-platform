import postgres from 'postgres';

export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:54329/hr';

/**
 * A privileged connection (migrations, seed, trusted server jobs). Connects as
 * the DB owner / service_role, which bypasses RLS.
 */
export function serviceClient() {
  return postgres(DATABASE_URL, { max: 4, onnotice: () => {} });
}

/**
 * Run `fn` impersonating an authenticated end-user, so RLS applies exactly as it
 * would for a real request. Sets the same GUC Supabase derives from the JWT.
 * Used by the app's request path and by RLS tests.
 */
export async function asUser<T>(
  sql: postgres.Sql,
  userId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  const result = await sql.begin(async (tx) => {
    await tx.unsafe(`set local role authenticated`);
    await tx.unsafe(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    await tx.unsafe(`select set_config('request.jwt.claim.role', 'authenticated', true)`, [] as never);
    return fn(tx);
  });
  return result as T;
}
