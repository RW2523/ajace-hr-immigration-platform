import Link from 'next/link';
import { Users, Search } from 'lucide-react';
import { getPrincipal, primaryRole } from '@/lib/session';
import { scopedEmployees } from '@/lib/data';
import { Card, Pill, EmptyState } from '@/components/ui';
import { redirect } from 'next/navigation';

function initials(n: string) { const p = n.split(/\s+/); return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase(); }

export default async function PeoplePage() {
  const principal = (await getPrincipal())!;
  if (primaryRole(principal) === 'employee') redirect('/dashboard');
  const people = await scopedEmployees(principal);

  return (
    <div>
      <div className="page-head between">
        <div>
          <div className="page-title">People</div>
          <div className="page-sub">Employees and consultants you support.</div>
        </div>
        <Pill tone="brand">{people.length} in scope</Pill>
      </div>

      <Card flat>
        <div className="topbar-search" style={{ width: '100%', display: 'flex' }}><Search size={15} /><input placeholder="Search people…" /></div>
      </Card>

      <Card>
        {people.length === 0 ? (
          <EmptyState icon={<Users size={22} />} title="No people in scope" />
        ) : (
          <div className="wrap-scroll">
            <table className="tbl">
              <thead><tr><th>Name</th><th>Type</th><th>Work authorization</th><th>Status</th></tr></thead>
              <tbody>
                {people.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <div className="row">
                        <div className="avatar" style={{ width: 34, height: 34, fontSize: 12 }}>{initials(e.full_name)}</div>
                        <span style={{ fontWeight: 650 }}>{e.full_name}</span>
                      </div>
                    </td>
                    <td className="muted" style={{ textTransform: 'capitalize' }}>{e.employment_type.replace('_', ' ')}</td>
                    <td>{e.work_authorization_category ? <Pill tone="brand">{e.work_authorization_category.replace(/_/g, ' ')}</Pill> : <span className="muted">—</span>}</td>
                    <td><Pill tone={e.status === 'offboarded' ? 'danger' : 'ok'}>{e.status}</Pill></td>
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
