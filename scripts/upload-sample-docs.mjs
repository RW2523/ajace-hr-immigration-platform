// Uploads real sample PDFs to the private hr-documents bucket (as Richard, via his
// Supabase session) so the in-app document preview works. Pure fetch, no deps.
// Run: node scripts/upload-sample-docs.mjs   (prints the storage paths to set)
const SUPABASE_URL = 'https://coaszrosqlhifcwxurwu.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNvYXN6cm9zcWxoaWZjd3h1cnd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0MDU1MDEsImV4cCI6MjA5Nzk4MTUwMX0.HKGSUM9UquUz0799jOVprvodx2RopgMB1tRwfxGL5uU';
const ORG = 'b0000000-0000-4000-8000-000000000001';
const EMP = 'c0000000-0000-4000-8000-000000000003';

function makePdf(lines) {
  const stream = 'BT /F1 22 Tf 60 720 Td 26 TL ' + lines.map((l) => `(${l}) Tj T*`).join(' ') + ' ET';
  const objs = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => { pdf += String(off).padStart(10, '0') + ' 00000 n \n'; });
  pdf += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'richard@ajace.com', password: 'Ajace@2026' }),
});
const tok = await tokenRes.json();
if (!tok.access_token) { console.error('login failed', tok); process.exit(1); }

const samples = [
  { key: 'ead_card', filename: 'sample_ead_i766.pdf', lines: ['AJACE Inc', 'Employment Authorization Document (I-766)', 'Sample preview file', 'Beneficiary: Richard'] },
  { key: 'i20', filename: 'sample_i20.pdf', lines: ['AJACE Inc', 'Form I-20 - Certificate of Eligibility', 'Sample preview file', 'Beneficiary: Richard'] },
];
const updates = [];
for (const s of samples) {
  const path = `${ORG}/${EMP}/${s.key}/${s.filename}`;
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/hr-documents/${encodeURI(path)}`, {
    method: 'POST', headers: { authorization: `Bearer ${tok.access_token}`, apikey: ANON, 'content-type': 'application/pdf', 'x-upsert': 'true' },
    body: makePdf(s.lines),
  });
  console.log(`upload ${s.key}: ${up.status} ${up.ok ? 'ok' : await up.text()}`);
  if (up.ok) updates.push(`update app.documents set storage_key='${path}', content_type='application/pdf', filename='${s.filename}' where employee_id='${EMP}' and document_type='${s.key}';`);
}
console.log('---SQL---');
console.log(updates.join('\n'));
