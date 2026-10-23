import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, qs } from '../api';
import { filterQuery, Filters, useFilters } from '../components/Filters';
import { UpdateButton } from '../components/UpdateButton';
import { countryName, fold, money, num } from '../format';
import type { BreakdownRow, RetentionCountry } from '../types';

type SortKey = 'country' | 'spend' | 'earnings' | 'profit' | 'cpi' | 'installs' | 'd1' | 'd7';

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'spend', label: 'Spend' },
  { key: 'earnings', label: 'Revenue' },
  { key: 'profit', label: 'Profit' },
  { key: 'installs', label: 'Installs' },
  { key: 'cpi', label: 'CPI' },
  { key: 'd1', label: 'D1' },
  { key: 'd7', label: 'D7' },
];

const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`;

/** Lỗ lãi theo quốc gia: chi phí quảng cáo (Facebook + Google Ads) so với doanh thu AdMob. */
export function RankingFinancePage() {
  const [filters, setFilters] = useFilters();
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'profit', desc: true });
  const [search, setSearch] = useState('');
  const q = qs(filterQuery(filters));

  const data = useQuery({
    queryKey: ['reports', 'breakdown', 'country', q],
    queryFn: () => api<BreakdownRow[]>(`/reports/breakdown?${q}&dimension=country&limit=500`),
  });

  // Retention GA4 theo nước (ngày cài trong cùng khoảng ngày; không theo app vì GA4 là số của cả app).
  const retention = useQuery({
    queryKey: ['retention', 'by-country', filters.from, filters.to],
    queryFn: () => api<RetentionCountry[]>(`/retention/by-country?${qs({ from: filters.from, to: filters.to })}`),
  });
  const retentionBy = new Map((retention.data ?? []).map((r) => [r.country, r]));

  const needle = fold(search.trim());
  const rows = (data.data ?? [])
    .map((r) => ({
      code: r.key,
      name: r.key === 'ZZ' ? 'Không rõ quốc gia' : countryName(r.key),
      spend: r.spend ?? 0,
      earnings: r.earnings,
      profit: r.profit ?? r.earnings,
      installs: r.installs ?? 0,
      cpi: r.installs ? (r.spend ?? 0) / r.installs : null,
      d1: retentionBy.get(r.key)?.d1 ?? null,
      d7: retentionBy.get(r.key)?.d7 ?? null,
    }))
    .filter((r) => !needle || fold(`${r.name} ${r.code}`).includes(needle));

  const value = (r: (typeof rows)[number]) => (sort.key === 'country' ? r.name : r[sort.key] ?? -Infinity);
  const sorted = [...rows].sort((a, b) => {
    const [x, y] = [value(a), value(b)];
    const cmp = typeof x === 'string' ? x.localeCompare(String(y), 'vi') : Number(x) - Number(y);
    return sort.desc ? -cmp : cmp;
  });

  const total = rows.reduce(
    (s, r) => ({ spend: s.spend + r.spend, earnings: s.earnings + r.earnings, installs: s.installs + r.installs }),
    { spend: 0, earnings: 0, installs: 0 },
  );
  const totalProfit = total.earnings - total.spend;
  // Retention tổng: trung bình có trọng số theo người dùng mới của các nước đang hiển thị.
  const retentionTotal = Object.fromEntries((['d1', 'd7'] as const).map((d) => {
    const shown = new Set(rows.map((r) => r.code));
    const ready = (retention.data ?? []).filter((r) => shown.has(r.country) && r[d] !== null);
    const users = ready.reduce((s, r) => s + r.newUsers, 0);
    return [d, users ? ready.reduce((s, r) => s + r[d]! * r.newUsers, 0) / users : null];
  })) as { d1: number | null; d7: number | null };
  const winners = rows.filter((r) => r.spend > 0 && r.profit > 0).length;
  const losers = rows.filter((r) => r.profit < 0).length;

  const header = (key: SortKey, label: string, numeric = true) => (
    <th className={`${numeric ? 'num ' : ''}sortable`}
      onClick={() => setSort({ key, desc: sort.key === key ? !sort.desc : key !== 'country' })}>
      {label}{sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : ''}
    </th>
  );

  return (
    <>
      <header className="page-header">
        <h1>Ranking Finance</h1>
        <UpdateButton />
      </header>
      <Filters value={filters} onChange={setFilters} />

      <section className="kpis">
        <Stat label="Spend" value={money(total.spend)} />
        <Stat label="Revenue" value={money(total.earnings)} />
        <Stat label="Profit" value={money(totalProfit)} tone={totalProfit < 0 ? 'neg' : 'pos'} />
        <Stat label="Nước có lãi" value={num(winners)} />
        <Stat label="Nước lỗ" value={num(losers)} tone={losers ? 'neg' : undefined} />
      </section>

      <div className="table-search">
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm quốc gia…" />
        {needle && <span className="small muted">{rows.length} / {data.data?.length ?? 0} nước</span>}
      </div>

      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th className="num">#</th>
              {header('country', 'Quốc gia', false)}
              {COLUMNS.map((c) => header(c.key, c.label))}
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 && (
              <tr className="total-row">
                <td />
                <td><b>Tổng ({rows.length} nước)</b></td>
                <td className="num"><b>{money(total.spend)}</b></td>
                <td className="num"><b>{money(total.earnings)}</b></td>
                <td className={`num ${totalProfit < 0 ? 'neg' : 'pos'}`}><b>{money(totalProfit)}</b></td>
                <td className="num"><b>{num(total.installs)}</b></td>
                <td className="num"><b>{total.installs ? money(total.spend / total.installs) : '—'}</b></td>
                <td className="num"><b>{retentionTotal.d1 === null ? '—' : pct1(retentionTotal.d1)}</b></td>
                <td className="num"><b>{retentionTotal.d7 === null ? '—' : pct1(retentionTotal.d7)}</b></td>
              </tr>
            )}
            {sorted.map((r, i) => (
              <tr key={r.code}>
                <td className="num muted">{i + 1}</td>
                <td title={r.code}>{r.name} <span className="muted small">{r.code}</span></td>
                <td className="num">{money(r.spend)}</td>
                <td className="num">{money(r.earnings)}</td>
                <td className={`num ${r.profit < 0 ? 'neg' : r.profit > 0 ? 'pos' : ''}`}>{money(r.profit)}</td>
                <td className="num">{num(r.installs)}</td>
                <td className="num">{r.cpi === null ? '—' : money(r.cpi)}</td>
                <td className="num">{r.d1 === null ? <span className="muted">—</span> : pct1(r.d1)}</td>
                <td className="num">{r.d7 === null ? <span className="muted">—</span> : pct1(r.d7)}</td>
              </tr>
            ))}
            {data.isLoading && <tr><td colSpan={9} className="center muted">Đang tải…</td></tr>}
            {!data.isLoading && !rows.length && <tr><td colSpan={9} className="center muted">Không có dữ liệu</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className="card kpi">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value ${tone === 'neg' ? 'error-text' : tone === 'pos' ? 'success-text' : ''}`}>{value}</div>
    </div>
  );
}
