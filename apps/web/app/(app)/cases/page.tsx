import Link from 'next/link';
import { FolderOpen, Search, Filter, ArrowRight, Plus } from 'lucide-react';
import { getPrincipal, primaryRole } from '@/lib/session';
import { scopedCases } from '@/lib/data';
import { Card, Pill, EmptyState } from '@/components/ui';

export default async function CasesPage() {
  const principal = (await getPrincipal())!;
  const role = primaryRole(principal);
  const isStaff = role !== 'employee';
  const cases = await scopedCases(principal);

  return (
    <div>
      <div className="page-head between">
        <div>
          <div className="page-title">{isStaff ? 'Cases' : 'My Cases'}</div>
          <div className="page-sub">{isStaff ? 'Immigration cases across the people you support.' : 'Track your immigration cases and next steps.'}</div>
        </div>
        {!isStaff && <Link href="/intake" className="btn btn-primary"><Plus size={16} /> Start intake</Link>}
      </div>

      <Card flat>
        <div className="row" style={{ gap: 12 }}>
          <div className="topbar-search" style={{ width: '100%', display: 'flex' }}>
            <Search size={15} /><input placeholder="Search cases…" />
          </div>
          <button className="btn btn-ghost"><Filter size={15} /> All types</button>
        </div>
      </Card>

      <Card>
        {cases.length === 0 ? (
          <EmptyState icon={<FolderOpen size={22} />} title="No cases yet" sub={isStaff ? 'Cases will appear here as employees are onboarded.' : 'Start intake to open your first case.'} />
        ) : (
          <div className="wrap-scroll">
            <table className="tbl">
              <thead><tr><th>Case</th><th>{isStaff ? 'Employee' : 'ID'}</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {cases.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div className="row">
                        <div style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--brand-50)', color: 'var(--brand-600)', display: 'grid', placeItems: 'center' }}><FolderOpen size={16} /></div>
                        <div>
                          <div style={{ fontWeight: 700 }}>{c.current_status.replace(/_/g, ' ')}</div>
                          <div className="muted" style={{ fontSize: 12 }}>{c.id.slice(0, 8)}…</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ fontWeight: 600 }}>{c.employee_name}</td>
                    <td><Pill tone="brand">{c.current_status.replace(/_/g, ' ')}</Pill></td>
                    <td style={{ textAlign: 'right' }}><Link href={`/cases/${c.id}`} className="btn btn-ghost btn-sm">View details <ArrowRight size={14} /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
