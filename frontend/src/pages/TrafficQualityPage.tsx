import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, qs } from '../api';
import { filterQuery, Filters, useFilters } from '../components/Filters';
import { countryName, fold, money, num } from '../format';
import type { BreakdownRow, RetentionCountry } from '../types';

/**
 * Ngưỡng cảnh báo. CTR quảng cáo app thường vài %, quá cao là dấu hiệu click không hợp lệ (AdMob trừ tiền);
 * D1 rất thấp là dấu hiệu lượt cài kém chất lượng / ảo. Chỉ là gợi ý để xem kỹ, không phải kết luận.
 */
const CTR_WARN = 0.1;
const CTR_BAD = 0.15;
const D1_WARN = 0.1;
const D1_BAD = 0.06;
/** Nước có ít lượt hiển thị / người dùng hơn thế thì số dao động mạnh, không gắn cờ. */
const MIN_IMPRESSIONS = 300;
const MIN_USERS = 20;

type Flag = { level: 'bad' | 'warn'; text: string };
type SortKey = 'risk' | 'country' | 'impressions' | 'ctr' | 'earnings' | 'ecpm' | 'spend' | 'installs' | 'cpi' | 'd1' | 'profit';

const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`;

function flagsOf(r: { impressions: number; ctr: number; d1: number | null; newUsers: number; spend: number; earnings: number }): Flag[] {
  const out: Flag[] = [];
  if (r.impressions >= MIN_IMPRESSIONS) {
    if (r.ctr >= CTR_BAD) out.push({ level: 'bad', text: `CTR ${pct1(r.ctr)} rất cao` });
    else if (r.ctr >= CTR_WARN) out.push({ level: 'warn', text: `CTR ${pct1(r.ctr)} cao` });
  }
  if (r.d1 !== null && r.newUsers >= MIN_USERS) {
    if (r.d1 < D1_BAD) out.push({ level: 'bad', text: `D1 ${pct1(r.d1)} rất thấp` });
    else if (r.d1 < D1_WARN) out.push({ level: 'warn', text: `D1 ${pct1(r.d1)} thấp` });
  }
  if (r.spend >= 5 && r.earnings < r.spend * 0.3) out.push({ level: 'warn', text: 'Doanh thu < 30% chi phí' });
  return out;
}

/**
 * Chất lượng traffic theo nước: doanh thu AdMob, CTR / eCPM quảng cáo, chi phí UA và retention D1 cạnh nhau, gắn cờ
 * nước có CTR cao bất thường hoặc D1 thấp (nguồn hay bị AdMob trừ "invalid traffic" và nên cân nhắc loại khỏi chiến dịch).
 */
export function TrafficQualityPage() {
  const [filters, setFilters] = useFilters(30);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'risk', desc: true });
  const [search, setSearch] = useState('');
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const q = qs(filterQuery(filters));

  const data = useQuery({
    queryKey: ['reports', 'breakdown', 'country', q],
    queryFn: () => api<BreakdownRow[]>(`/reports/breakdown?${q}&dimension=country&limit=500`),
  });
  const retention = useQuery({
    queryKey: ['retention', 'by-country', filters.from, filters.to],
    queryFn: () => api<RetentionCountry[]>(`/retention/by-country?${qs({ from: filters.from, to: filters.to })}`),
  });
  const retentionBy = new Map((retention.data ?? []).map((r) => [r.country, r]));

  const needle = fold(search.trim());
  const all = (data.data ?? []).map((r) => {
    const ret = retentionBy.get(r.key);
    const base = {
      code: r.key,
      name: r.key === 'ZZ' ? 'Không rõ quốc gia' : countryName(r.key),
      impressions: r.impressions,
      clicks: r.clicks,
      ctr: r.ctr,
      earnings: r.earnings,
      ecpm: r.ecpm,
      spend: r.spend ?? 0,
      installs: r.installs ?? 0,
      cpi: r.installs ? (r.spend ?? 0) / r.installs : null,
      profit: r.profit ?? r.earnings,
      d1: ret?.d1 ?? null,
      newUsers: ret?.newUsers ?? 0,
    };
    const flags = flagsOf(base);
    // Điểm rủi ro để sắp xếp: cờ đỏ nặng hơn cờ vàng, nhân theo quy mô (lượt hiển thị) để nước lớn lên trên.
    const risk = flags.reduce((s, f) => s + (f.level === 'bad' ? 3 : 1), 0) * Math.log10(10 + base.impressions);
    return { ...base, flags, risk };
  });
  const rows = all
    .filter((r) => !needle || fold(`${r.name} ${r.code}`).includes(needle))
    .filter((r) => !onlyFlagged || r.flags.length);

  const value = (r: (typeof rows)[number]) => (sort.key === 'country' ? r.name : r[sort.key] ?? -Infinity);
  const sorted = [...rows].sort((a, b) => {
    const [x, y] = [value(a), value(b)];
    const cmp = typeof x === 'string' ? x.localeCompare(String(y), 'vi') : Number(x) - Number(y);
    return sort.desc ? -cmp : cmp;
  });

  const sum = (k: 'impressions' | 'clicks' | 'earnings' | 'spend') => all.reduce((s, r) => s + r[k], 0);
  const totalCtr = sum('impressions') ? sum('clicks') / sum('impressions') : 0;
  const flagged = all.filter((r) => r.flags.some((f) => f.level === 'bad'));
  const flaggedEarnings = flagged.reduce((s, r) => s + r.earnings, 0);
  const flaggedSpend = flagged.reduce((s, r) => s + r.spend, 0);

  const header = (key: SortKey, label: string, numeric = true, title?: string) => (
    <th className={`${numeric ? 'num ' : ''}sortable`} title={title}
      onClick={() => setSort({ key, desc: sort.key === key ? !sort.desc : key !== 'country' })}>
      {label}{sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : ''}
    </th>
  );

  return (
    <>
      <header className="page-header"><h1>Chất lượng traffic theo nước</h1></header>
      <p className="small muted">
        Đặt cạnh nhau doanh thu AdMob, CTR quảng cáo, chi phí UA và retention D1 (GA4) của từng nước. Cờ đỏ: CTR ≥{' '}
        {pct1(CTR_BAD)} hoặc D1 &lt; {pct1(D1_BAD)}; cờ vàng: CTR ≥ {pct1(CTR_WARN)}, D1 &lt; {pct1(D1_WARN)} hoặc doanh thu
        dưới 30% chi phí. CTR quá cao là dấu hiệu click không hợp lệ (AdMob trừ tiền "Invalid traffic"), D1 quá thấp là
        dấu hiệu lượt cài kém chất lượng. Chỉ gắn cờ nước có ≥ {MIN_IMPRESSIONS} lượt hiển thị / ≥ {MIN_USERS} người dùng mới.
      </p>
      <Filters value={filters} onChange={setFilters} />

      <section className="kpis">
        <Stat label="CTR toàn bộ" value={pct1(totalCtr)} tone={totalCtr >= CTR_WARN ? 'neg' : undefined} />
        <Stat label="Nước cờ đỏ" value={num(flagged.length)} tone={flagged.length ? 'neg' : undefined} />
        <Stat label="Doanh thu từ nước cờ đỏ" value={`${money(flaggedEarnings)} (${sum('earnings') ? pct1(flaggedEarnings / sum('earnings')) : '—'})`} />
        <Stat label="Chi phí vào nước cờ đỏ" value={`${money(flaggedSpend)} (${sum('spend') ? pct1(flaggedSpend / sum('spend')) : '—'})`} />
      </section>

      <div className="table-search">
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm quốc gia…" />
        <label className="inline small">
          <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} /> Chỉ nước có cờ
        </label>
        <span className="small muted">{rows.length} / {all.length} nước</span>
      </div>

      <div className="card table-card">
        <table>
          <thead>
            <tr>
              {header('risk', 'Cảnh báo', false)}
              {header('country', 'Quốc gia', false)}
              {header('impressions', 'Lượt hiển thị')}
              {header('ctr', 'CTR', true, 'Click / lượt hiển thị quảng cáo AdMob')}
              {header('earnings', 'Doanh thu AdMob')}
              {header('ecpm', 'eCPM')}
              {header('spend', 'Spend UA')}
              {header('installs', 'Installs')}
              {header('cpi', 'CPI')}
              {header('d1', 'D1 (GA4)')}
              {header('profit', 'Profit')}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.code}>
                <td>
                  {r.flags.length
                    ? r.flags.map((f) => <span key={f.text} className={`badge ${f.level === 'bad' ? 'error' : 'warn'}`}>{f.text}</span>)
                    : <span className="muted small">—</span>}
                </td>
                <td title={r.code}>{r.name} <span className="muted small">{r.code}</span></td>
                <td className="num">{num(r.impressions)}</td>
                <td className={`num ${r.impressions >= MIN_IMPRESSIONS && r.ctr >= CTR_BAD ? 'neg' : ''}`}>{r.impressions ? pct1(r.ctr) : '—'}</td>
                <td className="num">{money(r.earnings)}</td>
                <td className="num">{r.impressions ? money(r.ecpm) : '—'}</td>
                <td className="num">{r.spend ? money(r.spend) : <span className="muted">—</span>}</td>
                <td className="num">{r.installs ? num(r.installs) : <span className="muted">—</span>}</td>
                <td className="num">{r.cpi === null ? '—' : money(r.cpi)}</td>
                <td className={`num ${r.d1 !== null && r.newUsers >= MIN_USERS && r.d1 < D1_BAD ? 'neg' : ''}`}
                  title={`${num(r.newUsers)} người dùng mới`}>
                  {r.d1 === null ? <span className="muted">—</span> : pct1(r.d1)}
                </td>
                <td className={`num ${r.profit < 0 ? 'neg' : r.profit > 0 ? 'pos' : ''}`}>{money(r.profit)}</td>
              </tr>
            ))}
            {data.isLoading && <tr><td colSpan={11} className="center muted">Đang tải…</td></tr>}
            {!data.isLoading && !rows.length && <tr><td colSpan={11} className="center muted">Không có dữ liệu</td></tr>}
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
