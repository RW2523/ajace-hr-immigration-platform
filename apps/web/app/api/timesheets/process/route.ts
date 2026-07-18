import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { buildModelInput } from '@/lib/timesheets/directpp/input';
import { directExtract } from '@/lib/timesheets/directpp/extractor';

// Serverless Direct++ timesheet extraction, ported into the platform. Reads an uploaded
// file with a vision/LLM model ladder (via OpenRouter) and returns the structured month.
// Session-gated. Returns the extraction for preview; persisting + review is the next step.
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: Request) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'bad form data' }, { status: 400 });
  }
  const file = form.get('file');
  const month = parseInt(String(form.get('month')), 10);
  const year = parseInt(String(form.get('year')), 10);
  if (!(file instanceof File) || !month || !year) {
    return NextResponse.json({ error: 'file, month, year required' }, { status: 400 });
  }
  if (!(process.env.OPENROUTER_API_KEY || process.env.TSE_OPENROUTER_API_KEY)) {
    return NextResponse.json({ error: 'OPENROUTER_API_KEY not configured' }, { status: 503 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const input = await buildModelInput(buffer, file.name);
  const { employee, trace, reason } = await directExtract({ input, fileName: file.name, month, year });
  if (!employee) {
    return NextResponse.json({ ok: false, reason: reason || 'could not extract', trace }, { status: 200 });
  }
  return NextResponse.json({ ok: true, employee, trace });
}
