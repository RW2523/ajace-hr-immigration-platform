/**
 * Offer-letter generation (§8). Renders a template with variables into letter text,
 * then records an offer_letters row with e-signature status. Producing the final
 * .docx/.pdf artifact is delegated to the docx/pdf skills at the app layer; this
 * service owns the data, variable substitution, and status tracking.
 */
import type postgres from 'postgres';

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

export async function generateOfferLetter(
  sql: postgres.Sql,
  employeeId: string,
  variables: OfferLetterVariables,
  templateKey = 'default',
  template = DEFAULT_OFFER_TEMPLATE,
): Promise<{ id: string; text: string }> {
  const text = renderTemplate(template, variables);
  const empRows = await sql<{ org_id: string }[]>`select org_id from app.employees where id = ${employeeId}`;
  const org_id = empRows[0]?.org_id;
  if (!org_id) throw new Error('employee not found');
  const [row] = await sql`
    insert into app.offer_letters (org_id, employee_id, template_key, variables, esign_status)
    values (${org_id}, ${employeeId}, ${templateKey}, ${sql.json(variables as never)}, 'draft')
    returning id`;
  return { id: row!.id as string, text };
}
