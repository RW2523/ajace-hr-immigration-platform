import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

// Persist a reviewed month: upsert the ts_timesheets record and insert the employee's
// submission into ts_employee_edits (submitted=true). All writes go through the user's
// session client, so RLS scopes them to their own rows (user_id = auth.uid()).
export const runtime = 'nodejs';

type DayIn = { date: string; total_hours?: number; regular_hours?: number; overtime_hours?: number };

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export async function POST(request: Request) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });

  let body: { month?: number; year?: number; record?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  const month = Number(body.month);
  const year = Number(body.year);
  const rec = (body.record ?? {}) as Record<string, unknown>;
  if (!month || !year) return NextResponse.json({ error: 'month, year required' }, { status: 400 });

  const days = (Array.isArray(rec.days) ? rec.days : []) as DayIn[];
  const worked = days.filter((d) => Number(d.total_hours) > 0).length;
  const total = round2(days.reduce((s, d) => s + (Number(d.total_hours) || 0), 0));
  const regular = round2(days.reduce((s, d) => s + (Number(d.regular_hours ?? d.total_hours) || 0), 0));
  const overtime = round2(days.reduce((s, d) => s + (Number(d.overtime_hours) || 0), 0));
  const clients = (rec.clients as string[] | undefined) ?? [];
  const client = clients[0] ?? (rec.client as string | undefined) ?? null;

  const tsRow = {
    user_id: user.id,
    month,
    year,
    employee_name: (rec.employee_name as string | null) ?? null,
    employee_id: (rec.employee_id as string | null) ?? null,
    client,
    projects: (rec.projects as string[] | undefined) ?? [],
    monthly_regular: regular,
    monthly_overtime: overtime,
    monthly_total: total,
    days_worked: worked,
    days,
    questionnaire: (rec.questionnaire as Record<string, unknown> | undefined) ?? {},
    validation: rec.issues ? { issues: rec.issues } : {},
    ai_confidence: (rec.confidence as number | null) ?? null,
    ai_status: (rec.review_status as string | undefined) ?? 'submitted',
  };

  // Upsert ts_timesheets for (user, month, year). RLS already scopes SELECT to the owner.
  const { data: existing } = await supabase
    .from('ts_timesheets')
    .select('id')
    .eq('month', month)
    .eq('year', year)
    .limit(1)
    .maybeSingle();

  let timesheetId: string | null = (existing?.id as string) ?? null;
  if (timesheetId) {
    const { error } = await supabase.from('ts_timesheets').update(tsRow).eq('id', timesheetId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  } else {
    const { data: ins, error } = await supabase.from('ts_timesheets').insert(tsRow).select('id').single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    timesheetId = (ins?.id as string) ?? null;
  }

  const { error: e2 } = await supabase.from('ts_employee_edits').insert({
    user_id: user.id,
    timesheet_id: timesheetId,
    month,
    year,
    fields: { employee_name: tsRow.employee_name, client },
    days,
    questionnaire: tsRow.questionnaire,
    validation: tsRow.validation,
    submitted: true,
  });
  if (e2) return NextResponse.json({ error: e2.message }, { status: 400 });

  return NextResponse.json({ ok: true, timesheet_id: timesheetId, monthly_total: total, days_worked: worked });
}
