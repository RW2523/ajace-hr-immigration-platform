/**
 * One-off: ingest text for the pre-seeded sample documents so the "answer from my
 * document" path is demoable. Real uploads auto-extract + ingest via the app.
 * Run: DATABASE_URL=... tsx src/ingest-sample-docs.ts
 */
import { serviceClient } from '@hr/db';
import { defaultEmbedder } from './embeddings.js';
import { ingestDocumentText } from './ingest.js';

const KNOWN: Record<string, string> = {
  ead_card: 'AJACE Inc Employment Authorization Document, Form I-766 (EAD card). Beneficiary: Richard. Category C03B (STEM OPT). This card authorizes employment in the United States under the F-1 STEM OPT extension. Card valid through 2026-10-05. USCIS-issued.',
  i20: 'AJACE Inc Form I-20, Certificate of Eligibility for Nonimmigrant (F-1) Student Status. Beneficiary: Richard. Program level: Master. STEM OPT recommendation is included on page 2. SEVIS record is active and in good standing. Signed by the Designated School Official (DSO).',
};

async function main() {
  const sql = serviceClient();
  const embedder = defaultEmbedder();
  try {
    const docs = await sql<{ id: string; org_id: string; employee_id: string | null; document_type: string; filename: string | null }[]>`
      select id, org_id, employee_id, document_type, filename from app.documents where document_type in ('ead_card','i20')`;
    for (const d of docs) {
      const text = KNOWN[d.document_type];
      if (!text || !d.employee_id) continue;
      const [emp] = await sql<{ user_id: string | null }[]>`select user_id from app.employees where id = ${d.employee_id}`;
      const n = await ingestDocumentText(sql, embedder, {
        orgId: d.org_id, employeeId: d.employee_id, userId: emp?.user_id ?? null,
        documentId: d.id, docType: d.document_type, filename: d.filename ?? d.document_type, text,
      });
      console.log(`✓ ${d.document_type} (${d.filename}) → ${n} chunk(s)`);
    }
  } finally {
    await sql.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
