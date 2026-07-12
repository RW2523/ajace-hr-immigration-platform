/**
 * Offer-letter generation (§8). Renders a template with variables into letter text,
 * then records an offer_letters row with e-signature status. Producing the final
 * .docx/.pdf artifact is delegated to the docx/pdf skills at the app layer; this
 * service owns the data, variable substitution, and status tracking.
 */
import type postgres from 'postgres';
import { requirePermission, type Principal } from '@hr/shared';

export interface OfferLetterVariables {
  employee_name: string;
  role_title: string;
  employment_type: 'placement' | 'direct_hire';
  start_date: string;
  compensation: string;
  work_location: string;
  employer_name: string;
  [k: string]: string;
}

export const DEFAULT_OFFER_TEMPLATE = `Dear {{employee_name}},

{{employer_name}} is pleased to offer you the position of {{role_title}} ({{employment_type}}),
beginning {{start_date}}. Your compensation will be {{compensation}}. Your primary work
location will be {{work_location}}.

This offer is contingent on satisfactory completion of employment eligibility verification
(Form I-9) and any applicable background checks.

Please sign below to indicate your acceptance.

Sincerely,
{{employer_name}}`;

const VAR = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Substitute {{variables}}; throws if any referenced variable is missing. */
export function renderTemplate(template: string, variables: Record<string, string>): string {
  const missing = new Set<string>();
  const out = template.replace(VAR, (_, name: string) => {
    if (!(name in variables)) {
      missing.add(name);
      return `{{${name}}}`;
    }
    return variables[name]!;
  });
  if (missing.size > 0) {
    throw new Error(`offer letter template missing variables: ${[...missing].join(', ')}`);
  }
  return out;
}

/** HTML-escape a value so variables can never inject markup into the letter. */
function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const EMPLOYMENT_TYPE_LABEL: Record<string, string> = {
  placement: 'Placement (W-2 consultant assigned to client engagements)',
  direct_hire: 'Direct Hire (full-time employee)',
};

/**
 * Deterministic offer-letter DOCUMENT body. Given the same variables it always
 * renders byte-identical HTML, so the stored artifact is reproducible and the
 * signed copy is stable. Includes the at-will statement and an acceptance block.
 * The app layer may hand this HTML to the pdf/docx skill to produce a filed
 * artifact; the signable record of truth lives on app.offer_letters.rendered_html.
 */
export function renderOfferLetterHtml(v: OfferLetterVariables): string {
  const typeLabel = EMPLOYMENT_TYPE_LABEL[v.employment_type] ?? esc(v.employment_type);
  return [
    `<article class="offer-letter">`,
    `<header><h1>${esc(v.employer_name)}</h1><p class="doc-kind">Offer of Employment</p></header>`,
    `<p>Dear ${esc(v.employee_name)},</p>`,
    `<p>${esc(v.employer_name)} is pleased to offer you the position of <strong>${esc(v.role_title)}</strong>, `,
    `beginning <strong>${esc(v.start_date)}</strong>.</p>`,
    `<table class="offer-terms">`,
    `<tr><th>Position</th><td>${esc(v.role_title)}</td></tr>`,
    `<tr><th>Employment type</th><td>${typeLabel}</td></tr>`,
    `<tr><th>Start date</th><td>${esc(v.start_date)}</td></tr>`,
    `<tr><th>Compensation</th><td>${esc(v.compensation)}</td></tr>`,
    `<tr><th>Work location</th><td>${esc(v.work_location)}</td></tr>`,
    `</table>`,
    `<p>This offer is contingent on satisfactory completion of employment eligibility `,
    `verification (Form I-9) within the legally required window and any applicable `,
    `background checks.</p>`,
    `<p><strong>At-will employment.</strong> Unless otherwise provided by a written `,
    `agreement signed by an authorized representative of ${esc(v.employer_name)}, your `,
    `employment is <em>at will</em>: either you or ${esc(v.employer_name)} may terminate `,
    `the employment relationship at any time, with or without cause and with or without `,
    `notice. This letter is not a contract of employment for any specific duration.</p>`,
    `<section class="acceptance">`,
    `<h2>Acceptance</h2>`,
    `<p>By signing below, I, ${esc(v.employee_name)}, accept this offer of employment `,
    `on the terms described above.</p>`,
    `<div class="sig-line"><span>Signature: ______________________________</span>`,
    `<span>Date: ______________</span></div>`,
    `</section>`,
    `<footer><p>Sincerely,</p><p>${esc(v.employer_name)}</p></footer>`,
    `</article>`,
  ].join('\n');
}

export async function generateOfferLetter(
  sql: postgres.Sql,
  employeeId: string,
  variables: OfferLetterVariables,
  templateKey = 'default',
  template = DEFAULT_OFFER_TEMPLATE,
): Promise<{ id: string; text: string; html: string }> {
  const text = renderTemplate(template, variables); // validates all variables present
  const html = renderOfferLetterHtml(variables);
  const empRows = await sql<{ org_id: string }[]>`select org_id from app.employees where id = ${employeeId}`;
  const org_id = empRows[0]?.org_id;
  if (!org_id) throw new Error('employee not found');
  const [row] = await sql`
    insert into app.offer_letters (org_id, employee_id, template_key, variables, rendered_html, esign_status)
    values (${org_id}, ${employeeId}, ${templateKey}, ${sql.json(variables as never)}, ${html}, 'draft')
    returning id`;
  return { id: row!.id as string, text, html };
}

export interface OfferLetterView {
  id: string;
  orgId: string;
  employeeId: string;
  ownerUserId: string | null;
  employeeName: string;
  variables: OfferLetterVariables;
  renderedHtml: string | null;
  esignStatus: string;
  signedAt: string | null;
  signerUserId: string | null;
  createdAt: string;
}

/** Load a letter with the identity attributes callers need to authorize access. */
export async function getOfferLetter(
  sql: postgres.Sql,
  id: string,
): Promise<OfferLetterView | null> {
  const [row] = await sql<
    {
      id: string; org_id: string; employee_id: string; owner_user_id: string | null;
      employee_name: string; variables: OfferLetterVariables; rendered_html: string | null;
      esign_status: string; signed_at: string | null; signer_user_id: string | null; created_at: string;
    }[]
  >`
    select o.id, o.org_id, o.employee_id, e.user_id as owner_user_id, e.full_name as employee_name,
      o.variables, o.rendered_html, o.esign_status,
      to_char(o.signed_at,'YYYY-MM-DD"T"HH24:MI:SSZ') as signed_at, o.signer_user_id,
      to_char(o.created_at,'YYYY-MM-DD') as created_at
    from app.offer_letters o join app.employees e on e.id = o.employee_id
    where o.id = ${id}`;
  if (!row) return null;
  return {
    id: row.id, orgId: row.org_id, employeeId: row.employee_id, ownerUserId: row.owner_user_id,
    employeeName: row.employee_name, variables: row.variables, renderedHtml: row.rendered_html,
    esignStatus: row.esign_status, signedAt: row.signed_at, signerUserId: row.signer_user_id,
    createdAt: row.created_at,
  };
}

/** Staff transition draft → sent. Load row, authorize, constrain UPDATE by org. */
export async function sendOfferLetter(
  sql: postgres.Sql,
  principal: Principal,
  id: string,
): Promise<void> {
  const letter = await getOfferLetter(sql, id);
  if (!letter) throw new Error('offer letter not found');
  requirePermission(principal, {
    resource: 'hr_items', action: 'update', requireContext: true,
    context: { orgId: letter.orgId, employeeId: letter.employeeId, ownerUserId: letter.ownerUserId ?? undefined },
  });
  if (letter.esignStatus !== 'draft' && letter.esignStatus !== 'sent') {
    throw new Error(`cannot send an offer letter in status '${letter.esignStatus}'`);
  }
  await sql`
    update app.offer_letters set esign_status = 'sent', sent_at = coalesce(sent_at, now())
    where id = ${id} and org_id = ${letter.orgId}`;
}

/**
 * The employee accepts/signs their OWN offer letter (sent → signed). The employee
 * is creating their acceptance signature, so this is gated as hr_items:create with
 * the owner-user in context — their own letter passes, another employee's is denied.
 */
export async function signOfferLetter(
  sql: postgres.Sql,
  principal: Principal,
  id: string,
): Promise<void> {
  const letter = await getOfferLetter(sql, id);
  if (!letter) throw new Error('offer letter not found');
  requirePermission(principal, {
    resource: 'hr_items', action: 'create', requireContext: true,
    context: { orgId: letter.orgId, employeeId: letter.employeeId, ownerUserId: letter.ownerUserId ?? undefined },
  });
  if (letter.esignStatus !== 'sent') {
    throw new Error(`offer letter must be sent before it can be signed (current: '${letter.esignStatus}')`);
  }
  await sql`
    update app.offer_letters
      set esign_status = 'signed', signed_at = now(), signer_user_id = ${principal.userId}
    where id = ${id} and org_id = ${letter.orgId}`;
}
