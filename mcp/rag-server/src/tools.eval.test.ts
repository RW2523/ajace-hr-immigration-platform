/**
 * rag-server evaluations: retrieval is access-scoped (no cross-user leak) and
 * rag_answer enforces the legal-advice guardrail (§10, §14).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serviceClient } from '@hr/db';
import { HashEmbedder, ingestChunk } from '@hr/rag';
import { resolvePrincipal } from '@hr/mcp-shared';
import { ragAnswer, ragSearch } from './tools.js';

const sql = serviceClient();
const embedder = new HashEmbedder();
const ids = {
  org: crypto.randomUUID(),
  uA: crypto.randomUUID(),
  uB: crypto.randomUUID(),
  eA: crypto.randomUUID(),
  eB: crypto.randomUUID(),
};

beforeAll(async () => {
  await sql`delete from app.rag_chunks where org_id = ${ids.org}`;
  await sql`delete from app.users where email like '%@rags.test'`;
  await sql`delete from app.organizations where name = 'RAGS Org'`;
  await sql`insert into app.organizations (id, name) values (${ids.org}, 'RAGS Org')`;
  await sql`insert into app.users (id, org_id, email, full_name) values
    (${ids.uA}, ${ids.org}, 'a@rags.test', 'A'), (${ids.uB}, ${ids.org}, 'b@rags.test', 'B')`;
  await sql`insert into app.employees (id, org_id, user_id, full_name, employment_type) values
    (${ids.eA}, ${ids.org}, ${ids.uA}, 'A', 'direct_hire'), (${ids.eB}, ${ids.org}, ${ids.uB}, 'B', 'direct_hire')`;
  const empRole = (await sql`select id from app.roles where key='employee'`)[0]!.id;
  await sql`insert into app.user_roles (user_id, role_id, org_id) values
    (${ids.uA}, ${empRole}, ${ids.org}), (${ids.uB}, ${empRole}, ${ids.org})`;
  await ingestChunk(sql, embedder, { orgId: ids.org, content: 'Employee A STEM OPT EAD expires 2027-05-01', docType: 'case_doc', ownerUserId: ids.uA, ownerEmployeeId: ids.eA });
  await ingestChunk(sql, embedder, { orgId: ids.org, content: 'Employee B H-1B receipt WAC999 pending', docType: 'case_doc', ownerUserId: ids.uB, ownerEmployeeId: ids.eB });
  await ingestChunk(sql, embedder, { orgId: ids.org, content: 'Remote work policy: core hours 10-4', docType: 'policy', ownerUserId: null, ownerEmployeeId: null });
});

afterAll(async () => {
  await sql`delete from app.rag_chunks where org_id = ${ids.org}`;
  await sql`delete from app.users where org_id = ${ids.org}`;
  await sql`delete from app.organizations where id = ${ids.org}`;
  await sql.end();
});

describe('rag_search is access-scoped', () => {
  it('employee A gets own + shared, never B', async () => {
    const a = (await resolvePrincipal(sql, ids.uA))!;
    const r = await ragSearch(sql, a, { query: 'STEM OPT EAD H-1B receipt policy', k: 10 }, embedder);
    const text = r.results.map((x) => x.content).join(' | ');
    expect(text).toContain('Employee A STEM OPT');
    expect(text).toContain('Remote work policy');
    expect(text).not.toContain('Employee B');
  });

  it('employee B cannot pull A\'s chunk even by querying its exact content', async () => {
    const b = (await resolvePrincipal(sql, ids.uB))!;
    const r = await ragSearch(sql, b, { query: 'Employee A STEM OPT EAD 2027-05-01', k: 10 }, embedder);
    expect(r.results.map((x) => x.content).join(' ')).not.toContain('Employee A STEM OPT');
  });
});

describe('rag_answer guardrail (§14)', () => {
  it('routes legal-judgment questions to counsel without generation', async () => {
    const a = (await resolvePrincipal(sql, ids.uA))!;
    let called = false;
    const r = await ragAnswer(sql, a, { question: 'Should I file an appeal for my denial?' }, { embedder, complete: async () => { called = true; return 'x'; } });
    expect(r.routed_to_counsel).toBe(true);
    expect(called).toBe(false);
  });

  it('answers status questions from scoped context only', async () => {
    const a = (await resolvePrincipal(sql, ids.uA))!;
    const r = await ragAnswer(sql, a, { question: 'When does my STEM OPT EAD expire?' }, { embedder, complete: async (_s, u) => u.includes('Employee A') ? 'Your EAD expires 2027-05-01' : 'no data' });
    expect(r.routed_to_counsel).toBe(false);
    expect(r.sources.map((s) => s.content).join(' ')).not.toContain('Employee B');
  });
});
