/**
 * Minimal forward-only migration runner. Applies every .sql file in ./migrations
 * in lexical order, recording applied files in app_meta.migrations. Idempotent.
 *
 *   tsx src/migrate.ts            # apply pending migrations
 *   tsx src/migrate.ts --reset    # drop the app/auth schemas first, then apply all
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serviceClient } from './client.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');

async function main() {
  const reset = process.argv.includes('--reset');
  const sql = serviceClient();
  try {
    if (reset) {
      console.log('↺ resetting schemas app, auth (cascade)…');
      await sql.unsafe(`drop schema if exists app cascade; drop schema if exists auth cascade;`);
      // keep meta so we re-run everything
      await sql.unsafe(`drop table if exists app_meta.migrations;`);
    }

    await sql.unsafe(`create schema if not exists app_meta;`);
    await sql.unsafe(`
      create table if not exists app_meta.migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      );`);

    const applied = new Set(
      (await sql`select name from app_meta.migrations`).map((r) => r.name as string),
    );

    const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const body = readFileSync(join(migrationsDir, file), 'utf8');
      process.stdout.write(`→ applying ${file} … `);
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into app_meta.migrations (name) values (${file})`;
      });
      console.log('ok');
      count++;
    }
    console.log(count === 0 ? '✓ up to date' : `✓ applied ${count} migration(s)`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
