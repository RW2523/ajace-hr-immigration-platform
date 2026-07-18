'use client';
import { useState, type CSSProperties, type FormEvent } from 'react';
import { Upload, CheckCircle2, AlertTriangle } from 'lucide-react';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type Emp = {
  employee_name: string | null;
  monthly_total: number;
  monthly_regular: number;
  monthly_overtime: number;
  days_worked: number;
  review_status: string;
  confidence: number;
  notes?: string[];
};

const ctl: CSSProperties = { border: '1px solid var(--border, #cbd5e1)', borderRadius: 8, padding: '7px 9px', fontSize: 13, background: '#fff' };
const btn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#4f46e5', color: '#fff', border: 0, borderRadius: 8, padding: '8px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };

export function UploadTimesheet() {
  const now = new Date();
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [year, setYear] = useState(now.getUTCFullYear());
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [emp, setEmp] = useState<Emp | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    setEmp(null);
    try {
      const fd = new FormData();
      fd.set('file', file);
      fd.set('month', String(month));
      fd.set('year', String(year));
      const res = await fetch('/api/timesheets/process', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) setErr(json.error || `HTTP ${res.status}`);
      else if (!json.ok) setMsg(`Couldn’t extract: ${json.reason}`);
      else setEmp(json.employee as Emp);
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))} style={ctl} aria-label="Month">
          {MONTHS.map((m, i) => (
            <option key={i} value={i + 1}>{m}</option>
          ))}
        </select>
        <input type="number" value={year} min={2000} max={2100} onChange={(e) => setYear(Number(e.target.value))} style={{ ...ctl, width: 92 }} aria-label="Year" />
        <input
          type="file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv,.eml,.docx"
          style={{ fontSize: 13 }}
        />
        <button type="submit" disabled={!file || busy} style={{ ...btn, opacity: !file || busy ? 0.6 : 1 }}>
          <Upload size={15} /> {busy ? 'Extracting…' : 'Extract with AI'}
        </button>
      </div>

      {err && (
        <div style={{ color: '#b91c1c', fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
          <AlertTriangle size={14} /> {err}
        </div>
      )}
      {msg && <div style={{ color: '#b45309', fontSize: 13 }}>{msg}</div>}

      {emp && (
        <div style={{ background: 'var(--bg-soft, #f8fafc)', border: '1px solid var(--border, #e2e8f0)', borderRadius: 10, padding: 12 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600 }}>
            <CheckCircle2 size={16} color="#16a34a" /> Extracted — {emp.employee_name || 'employee'}
          </div>
          <div style={{ fontSize: 13, marginTop: 6, color: 'var(--muted, #64748b)' }}>
            {emp.monthly_total}h total ({emp.monthly_regular}h reg + {emp.monthly_overtime}h OT) · {emp.days_worked} days ·{' '}
            {Math.round((emp.confidence ?? 0) * 100)}% conf · <strong>{emp.review_status}</strong>
          </div>
          {emp.notes && emp.notes.length > 0 && (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--muted-2, #94a3b8)' }}>
              {emp.notes.slice(0, 4).map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
          <div style={{ fontSize: 11.5, color: 'var(--muted-2, #94a3b8)', marginTop: 8 }}>
            Preview only for now — saving the extracted month to your records + the calendar review is the next step.
          </div>
        </div>
      )}
    </form>
  );
}
