/**
 * Populate the RAG knowledge base for every org: immigration rules + policies
 * (org-shared) and per-employee case facts (owner-scoped). Idempotent.
 * Run: DATABASE_URL=... tsx src/ingest-cli.ts
 */
import { serviceClient } from '@hr/db';
import { defaultEmbedder } from './embeddings.js';
import { ingestAll } from './ingest.js';

async function main() {
  const sql = serviceClient();
  const embedder = defaultEmbedder();
  try {
    const orgs = await sql<{ id: string; name: string }[]>`select id, name from app.organizations`;
    for (const o of orgs) {
      const r = await ingestAll(sql, embedder, o.id);
      console.log(`✓ ${o.name}: ${r.knowledge} knowledge chunks + ${r.facts} personal facts`);
    }
    const total = (await sql<{ total: number }[]>`select count(*)::int total from app.rag_chunks`)[0]?.total ?? 0;
    console.log(`rag_chunks total: ${total}`);
  } finally {
    await sql.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
