import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, qs } from '../api';
import { daysAgo, money } from '../format';
import type { AppInfo, BreakdownRow } from '../types';

export function AppsPage() {
  const apps = useQuery({ queryKey: ['apps'], queryFn: () => api<AppInfo[]>('/admob/apps') });
  const range = { from: daysAgo(29), to: daysAgo(0) };
  const q = qs(range);
  const revenue = useQuery({
    queryKey: ['reports', 'breakdown', 'app', q],
    queryFn: () => api<BreakdownRow[]>(`/reports/breakdown?${q}&dimension=app&limit=500`),
  });
  const byApp = new Map(revenue.data?.map((r) => [r.key, r]));

  return (
    <>
      <header className="page-header"><h1>Ứng dụng</h1></header>
      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Tên</th>
              <th>Package</th>
              <th>Nền tảng</th>
              <th>Tài khoản</th>
              <th className="num">Ad units</th>
              <th className="num">Doanh thu 30 ngày</th>
              <th className="num">eCPM 30 ngày</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {apps.data?.map((a) => (
              <tr key={a.id}>
                <td className="label-cell" title={a.id}>{a.name}</td>
                <td>
                  {a.storeId ? (
                    <a href={`https://play.google.com/store/apps/details?id=${a.storeId}`} target="_blank" rel="noreferrer">
                      {a.storeId}
                    </a>
                  ) : <span className="muted">—</span>}
                </td>
                <td>{a.platform}</td>
                <td>{a.account.name}</td>
                <td className="num">{a._count.adUnits}</td>
                <td className="num">{money(byApp.get(a.id)?.earnings ?? 0)}</td>
                <td className="num">{money(byApp.get(a.id)?.ecpm ?? 0)}</td>
                <td><Link to={`/breakdown?${qs({ ...range, apps: [a.id] })}`}>Chi tiết →</Link></td>
              </tr>
            ))}
            {apps.data?.length === 0 && (
              <tr><td colSpan={8} className="center muted">Chưa có app nào. Hãy kết nối tài khoản AdMob.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
