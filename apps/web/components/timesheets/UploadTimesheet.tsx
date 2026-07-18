'use client';
import { useState, type CSSProperties, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, CheckCircle2, AlertTriangle, Send } from 'lucide-react';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type EmpDay = { date: string; total_hours?: number | null; regular_hours?: number | null; overtime_hours?: number | null };
type Emp = {
  employee_name: string | null;
  employee_id?: string | null;
  monthly_total: number;
  monthly_regular: number;
  monthly_overtime: number;
  days_worked: number;
  review_status: string;
  confidence: number;
  notes?: string[];
  days?: EmpDay[];
  clients?: string[];
  projects?: string[];
  issues?: unknown[];
};
type DayRow = { date: string; hours: number };

const ctl: CSSProperties = { border: '1px solid var(--border, #cbd5e1)', borderRadius: 8, padding: '7px 9px', fontSize: 13, background: '#fff' };
const btn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#4f46e5', color: '#fff', border: 0, borderRadius: 8, padding: '8px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function UploadTimesheet() {
  const router = useRouter();
  const now = new Date();
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [year, setYear] = useState(now.getUTCFullYear());
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [emp, setEmp] = useState<Emp | null>(null);
  const [days, setDays] = useState<DayRow[]>([]);
  const [workedWeekends, setWorkedWeekends] = useState<'no' | 'yes'>('no');
  const [ptoDays, setPtoDays] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function onExtract(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    setEmp(null);
    setSubmitted(false);
    try {
      const fd = new FormData();
      fd.set('file', file);
      fd.set('month', String(month));
      fd.set('year', String(year));
      const res = await fetch('/api/timesheets/process', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) setErr(json.error || `HTTP ${res.status}`);
      else if (!json.ok) setMsg(`Couldn’t extract: ${json.reason}`);
      else {
        const e2 = json.employee as Emp;
        setEmp(e2);
        setDays((e2.days ?? []).map((d) => ({ date: d.date, hours: Number(d.total_hours ?? d.regular_hours ?? 0) })));
      }
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit() {
    if (!emp) return;
    setSubmitting(true);
    setErr(null);
    try {
      const record = {
        ...emp,
        days: days.map((d) => ({ date: d.date, total_hours: Number(d.hours) || 0 })),
        questionnaire: { worked_weekends: workedWeekends, pto_days: ptoDays },
      };
      const res = await fetch('/api/timesheets/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, year, record }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) setErr(json.error || `HTTP ${res.status}`);
      else {
        setSubmitted(true);
        router.refresh();
      }
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const total = round2(days.reduce((s, d) => s + (Number(d.hours) || 0), 0));
  const worked = days.filter((d) => Number(d.hours) > 0).length;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <form onSubmit={onExtract} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))} style={ctl} aria-label="Month">
          {MONTHS.map((m, i) => (
            <option key={i} value={i + 1}>{m}</option>
          ))}
        </select>
        <input type="number" value={year} min={2000} max={2100} onChange={(e) => setYear(Number(e.target.value))} style={{ ...ctl, width: 92 }} aria-label="Year" />
        <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv,.eml,.docx" style={{ fontSize: 13 }} />
        <button type="submit" disabled={!file || busy} style={{ ...btn, opacity: !file || busy ? 0.6 : 1 }}>
          <Upload size={15} /> {busy ? 'Extracting…' : 'Extract with AI'}
        </button>
      </form>

      {err && (
        <div style={{ color: '#b91c1c', fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
          <AlertTriangle size={14} /> {err}
        </div>
      )}
      {msg && <div style={{ color: '#b45309', fontSize: 13 }}>{msg}</div>}

      {emp && submitted && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: '#16a34a', fontWeight: 600, fontSize: 14 }}>
          <CheckCircle2 size={16} /> Submitted — {total}h over {worked} days saved to your timesheets.
        </div>
      )}

      {emp && !submitted && (
        <div style={{ background: 'var(--bg-soft, #f8fafc)', border: '1px solid var(--border, #e2e8f0)', borderRadius: 10, padding: 12, display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600 }}>
            <CheckCircle2 size={16} color="#16a34a" /> Extracted — {emp.employee_name || 'employee'}
            <span style={{ marginLeft: 'auto', color: 'var(--muted, #64748b)', fontWeight: 500, fontSize: 12.5 }}>
              {Math.round((emp.confidence ?? 0) * 100)}% conf · {emp.review_status}
            </span>
          </div>

          <div style={{ fontSize: 12.5, color: 'var(--muted, #64748b)' }}>Review each day, then submit. Total updates live.</div>
          <div style={{ maxHeight: 240, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 6 }}>
            {days.length === 0 ? (
              <div className="muted" style={{ fontSize: 13 }}>No daily entries — the source only gave a monthly total.</div>
            ) : (
              days.map((d, i) => (
                <label key={d.date} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                  <span style={{ width: 82, color: 'var(--muted, #64748b)' }}>{d.date.slice(5)}</span>
                  <input
                    type="number"
                    step="0.5"
                    min={0}
                    max={24}
                    value={d.hours}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setDays((prev) => prev.map((x, j) => (j === i ? { ...x, hours: v } : x)));
                    }}
                    style={{ ...ctl, width: 64, padding: '5px 7px' }}
                  />
                </label>
              ))
            )}
          </div>

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5 }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              Worked weekends?
              <select value={workedWeekends} onChange={(e) => setWorkedWeekends(e.target.value as 'no' | 'yes')} style={{ ...ctl, padding: '5px 7px' }}>
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              PTO days
              <input type="number" min={0} max={31} value={ptoDays} onChange={(e) => setPtoDays(Number(e.target.value))} style={{ ...ctl, width: 60, padding: '5px 7px' }} />
            </label>
            <span style={{ marginLeft: 'auto', fontWeight: 600 }}>{total}h · {worked} days</span>
            <button type="button" onClick={onSubmit} disabled={submitting} style={{ ...btn, background: '#16a34a', opacity: submitting ? 0.6 : 1 }}>
              <Send size={15} /> {submitting ? 'Submitting…' : 'Submit timesheet'}
            </button>
          </div>

          {emp.notes && emp.notes.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--muted-2, #94a3b8)' }}>
              {emp.notes.slice(0, 4).map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
