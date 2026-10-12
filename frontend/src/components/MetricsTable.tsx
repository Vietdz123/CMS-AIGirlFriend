import { useState } from 'react';
import { compact, money, num, pct } from '../format';
import type { Metrics } from '../types';

type Row = Metrics & { key: string; label: string };
type SortKey = keyof Metrics;

const COLUMNS: { key: SortKey; label: string; render: (m: Metrics) => string }[] = [
  { key: 'earnings', label: 'Doanh thu', render: (m) => money(m.earnings) },
  { key: 'ecpm', label: 'eCPM', render: (m) => money(m.ecpm) },
  { key: 'impressions', label: 'Impressions', render: (m) => num(m.impressions) },
  { key: 'adRequests', label: 'Requests', render: (m) => compact(m.adRequests) },
  { key: 'matchRate', label: 'Match rate', render: (m) => pct(m.matchRate) },
  { key: 'showRate', label: 'Show rate', render: (m) => pct(m.showRate) },
  { key: 'clicks', label: 'Clicks', render: (m) => num(m.clicks) },
  { key: 'ctr', label: 'CTR', render: (m) => pct(m.ctr) },
];

export function MetricsTable({ rows, title, hideRequests, onRowClick }: {
  rows: Row[];
  title: string;
  /** Ad source report: request là request waterfall nên match/show rate không có nghĩa so sánh. */
  hideRequests?: boolean;
  onRowClick?: (row: Row) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'earnings', desc: true });
  const columns = hideRequests
    ? COLUMNS.filter((c) => !['adRequests', 'matchRate', 'showRate'].includes(c.key))
    : COLUMNS;
  const total = rows.reduce((s, r) => s + r.earnings, 0);
  const sorted = [...rows].sort((a, b) => (sort.desc ? b[sort.key] - a[sort.key] : a[sort.key] - b[sort.key]));

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
