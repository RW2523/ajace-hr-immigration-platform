/**
 * Phase 5 DoD: access-scoped retrieval must never leak another person's data, and
 * the assistant must never emit legal advice. These are the two security gates of
 * the RAG layer (§10, §14).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serviceClient } from '@hr/db';
import { roleByKey, type Principal } from '@hr/shared';
import { HashEmbedder, ingestChunk, retrieve, ask, requiresCounsel } from './index.js';

const sql = serviceClient();
const embedder = new HashEmbedder();

const ids = {
  org: crypto.randomUUID(),
  org2: crypto.randomUUID(),
  uEmpA: crypto.randomUUID(),
  uEmpB: crypto.randomUUID(),
  uHr: crypto.randomUUID(),
  empA: crypto.randomUUID(),
  empB: crypto.randomUUID(),
};

function principal(userId: string, orgId: string, roleKey: string, over: Partial<Principal> = {}): Principal {
  return {
    userId,
    orgId,
    assignedEmployeeIds: over.assignedEmployeeIds ?? [],
    permissions: roleByKey(roleKey)!.permissions,
    roleKeys: [roleKey],
    ...over,
  };
}

beforeAll(async () => {
  await sql`delete from app.rag_chunks where org_id in (${ids.org}, ${ids.org2})`;
  await sql`delete from app.users where email like '%@rag.test'`;
  await sql`delete from app.organizations where name in ('RAG Org','RAG Org2')`;
  await sql`insert into app.organizations (id, name) values (${ids.org}, 'RAG Org'), (${ids.org2}, 'RAG Org2')`;
  await sql`insert into app.users (id, org_id, email, full_name) values
    (${ids.uEmpA}, ${ids.org}, 'a@rag.test', 'A'),
    (${ids.uEmpB}, ${ids.org}, 'b@rag.test', 'B'),
    (${ids.uHr}, ${ids.org}, 'hr@rag.test', 'HR')`;
  await sql`insert into app.employees (id, org_id, user_id, full_name, employment_type) values
    (${ids.empA}, ${ids.org}, ${ids.uEmpA}, 'A', 'direct_hire'),
    (${ids.empB}, ${ids.org}, ${ids.uEmpB}, 'B', 'direct_hire')`;

  // A private case chunk for employee A, one for B, and one org-shared policy chunk.
  await ingestChunk(sql, embedder, { orgId: ids.org, content: 'Employee A H-1B validity expires 2027-03-15 receipt EAC123', docType: 'case_doc', ownerUserId: ids.uEmpA, ownerEmployeeId: ids.empA });
  await ingestChunk(sql, embedder, { orgId: ids.org, content: 'Employee B OPT EAD expires 2026-11-01 SEVIS N000B', docType: 'case_doc', ownerUserId: ids.uEmpB, ownerEmployeeId: ids.empB });
  await ingestChunk(sql, embedder, { orgId: ids.org, content: 'Company PTO policy: 15 days accrue annually', docType: 'policy', ownerUserId: null, ownerEmployeeId: null });
  // A chunk in a DIFFERENT org — must never surface.
  await ingestChunk(sql, embedder, { orgId: ids.org2, content: 'Other org secret H-1B data', docType: 'case_doc', ownerUserId: null, ownerEmployeeId: null });
});

afterAll(async () => {
  await sql`delete from app.rag_chunks where org_id in (${ids.org}, ${ids.org2})`;
  await sql`delete from app.users where org_id = ${ids.org}`;
  await sql`delete from app.organizations where id in (${ids.org}, ${ids.org2})`;
  await sql.end();
});

describe('access-scoped retrieval (§10) — no cross-user/cross-org leak', () => {
  it('employee A retrieves their own case chunk + org-shared policy, never B\'s', async () => {
    const results = await retrieve(sql, embedder, principal(ids.uEmpA, ids.org, 'employee'), 'H-1B validity expiry', 10);
    const contents = results.map((r) => r.content).join(' | ');
    expect(contents).toContain('Employee A H-1B validity');
    expect(contents).not.toContain('Employee B');
    expect(contents).not.toContain('Other org secret');
  });

  it('employee A can retrieve the org-shared policy chunk', async () => {
    const results = await retrieve(sql, embedder, principal(ids.uEmpA, ids.org, 'employee'), 'PTO policy accrual', 10);
    expect(results.map((r) => r.content).join(' ')).toContain('PTO policy');
  });

  it('employee B NEVER sees employee A\'s case data even when querying for it', async () => {
    const results = await retrieve(sql, embedder, principal(ids.uEmpB, ids.org, 'employee'), 'Employee A H-1B validity EAC123', 10);
    expect(results.map((r) => r.content).join(' ')).not.toContain('Employee A H-1B validity');
  });

  it('HR with assignment to A can retrieve A\'s chunk; unassigned cannot reach B', async () => {
    const hr = principal(ids.uHr, ids.org, 'hr', { assignedEmployeeIds: [ids.empA] });
    const results = await retrieve(sql, embedder, hr, 'H-1B validity OPT EAD', 10);
    const contents = results.map((r) => r.content).join(' | ');
    expect(contents).toContain('Employee A H-1B validity');
    expect(contents).not.toContain('Employee B OPT EAD');
  });

  it('cross-org isolation: no query returns another org\'s chunk', async () => {
    const results = await retrieve(sql, embedder, principal(ids.uEmpA, ids.org, 'employee'), 'secret H-1B data', 10);
    expect(results.map((r) => r.content).join(' ')).not.toContain('Other org secret');
  });
});

describe('legal-advice guardrail (§14)', () => {
  it('detects legal-judgment questions', () => {
    expect(requiresCounsel('How should I respond to my RFE?')).toBe(true);
    expect(requiresCounsel('Should I file for consular processing or change of status?')).toBe(true);
    expect(requiresCounsel('Am I legally eligible for a green card?')).toBe(true);
    expect(requiresCounsel('When does my OPT EAD expire?')).toBe(false);
    expect(requiresCounsel('What documents do I need for STEM OPT?')).toBe(false);
  });

  it('routes legal questions to counsel WITHOUT calling the model', async () => {
    let modelCalled = false;
    const answer = await ask(
      { sql, embedder, complete: async () => { modelCalled = true; return 'should not happen'; } },
      principal(ids.uEmpA, ids.org, 'employee'),
      'Should I respond to my RFE by appealing?',
    );
    expect(answer.routedToCounsel).toBe(true);
    expect(modelCalled).toBe(false);
    expect(answer.answer).toMatch(/counsel/i);
  });

  it('answers a status question using only scoped context', async () => {
    const answer = await ask(
      { sql, embedder, complete: async (_sys, user) => `Based on context: ${user.includes('Employee A') ? 'found A' : 'no data'}` },
      principal(ids.uEmpA, ids.org, 'employee'),
      'When does my H-1B validity expire?',
    );
    expect(answer.routedToCounsel).toBe(false);
    expect(answer.sources.length).toBeGreaterThan(0);
    // The context passed to the model must not contain B's data.
    expect(answer.sources.map((s) => s.content).join(' ')).not.toContain('Employee B');
  });
});
