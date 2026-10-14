import { useState } from 'react';
import { compact, money, num, pct, ratio } from '../format';
import type { Metrics, SpendMetrics } from '../types';

type Row = Metrics & Partial<SpendMetrics> & { key: string; label: string };
type SortKey = keyof (Metrics & SpendMetrics);

const SPEND_COLUMNS: { key: SortKey; label: string; render: (m: Row) => string }[] = [
  { key: 'spend', label: 'Chi phí', render: (m) => money(m.spend ?? 0) },
  { key: 'profit', label: 'Lợi nhuận', render: (m) => money(m.profit ?? 0) },
  { key: 'roas', label: 'ROAS', render: (m) => (m.spend ? ratio(m.roas ?? 0) : '—') },
  { key: 'installs', label: 'Installs', render: (m) => num(m.installs ?? 0) },
  { key: 'cpi', label: 'CPI', render: (m) => (m.installs ? money(m.cpi ?? 0) : '—') },
];

const COLUMNS: { key: SortKey; label: string; render: (m: Row) => string }[] = [
  { key: 'earnings', label: 'Doanh thu', render: (m) => money(m.earnings) },
  { key: 'ecpm', label: 'eCPM', render: (m) => money(m.ecpm) },
  { key: 'impressions', label: 'Impressions', render: (m) => num(m.impressions) },
  { key: 'adRequests', label: 'Requests', render: (m) => compact(m.adRequests) },
  { key: 'matchRate', label: 'Match rate', render: (m) => pct(m.matchRate) },
  { key: 'showRate', label: 'Show rate', render: (m) => pct(m.showRate) },
  { key: 'clicks', label: 'Clicks', render: (m) => num(m.clicks) },
  { key: 'ctr', label: 'CTR', render: (m) => pct(m.ctr) },
];

export function MetricsTable({ rows, title, hideRequests, showSpend, onRowClick }: {
  rows: Row[];
  title: string;
  /** Thêm cột chi phí quảng cáo Facebook + Google Ads (chỉ có khi xem theo app / quốc gia). */
  showSpend?: boolean;
  /** Ad source report: request là request waterfall nên match/show rate không có nghĩa so sánh. */
  hideRequests?: boolean;
  onRowClick?: (row: Row) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'earnings', desc: true });
  const base = hideRequests
    ? COLUMNS.filter((c) => !['adRequests', 'matchRate', 'showRate'].includes(c.key))
    : COLUMNS;
  const columns = showSpend ? [base[0], ...SPEND_COLUMNS, ...base.slice(1)] : base;
  const total = rows.reduce((s, r) => s + r.earnings, 0);
  const value = (r: Row) => r[sort.key] ?? 0;
  const sorted = [...rows].sort((a, b) => (sort.desc ? value(b) - value(a) : value(a) - value(b)));

  return (
    <div className="card table-card">
      <table>
        <thead>
          <tr>
            <th>{title}</th>
            {columns.map((c) => (
              <th key={c.key} className="num sortable"
                onClick={() => setSort({ key: c.key, desc: sort.key === c.key ? !sort.desc : true })}>
                {c.label}{sort.key === c.key ? (sort.desc ? ' ↓' : ' ↑') : ''}
              </th>
            ))}
            <th className="num">% DT</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.key} className={onRowClick ? 'clickable' : undefined} onClick={() => onRowClick?.(r)}>
              <td className="label-cell" title={r.key}>{r.label}</td>
              {columns.map((c) => <td key={c.key} className="num">{c.render(r)}</td>)}
              <td className="num">
                <div className="share">
                  <div className="share-bar" style={{ width: `${total ? (r.earnings / total) * 100 : 0}%` }} />
                  <span>{pct(total ? r.earnings / total : 0)}</span>
                </div>
              </td>
            </tr>
          ))}
          {!rows.length && (
            <tr><td colSpan={columns.length + 2} className="center muted">Không có dữ liệu</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
