import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, post, qs } from '../api';
import { useAuth } from '../auth';
import { DateRangePicker } from '../components/DateRangePicker';
import { DayPicker } from '../components/DayPicker';
import { SearchSelect } from '../components/SearchSelect';
import { countryName, countryOptions, daysAgo, money, num, relative } from '../format';
import type { RetentionCompare, RetentionDay, RetentionStatus, RevenueByInstall } from '../types';

const DEFAULT_DAYS = [1, 3, 7, 14];
/** Nguồn lọc sẵn khi mở trang (firstUserSource của người dùng đến từ Google Ads). */
const DEFAULT_SOURCE = 'google';
const EXTRA_DAYS = [40, 45, 60];

/** Tên dễ đọc cho firstUserSource của GA4. */
const SOURCE_LABELS: Record<string, string> = {
  'apps.facebook.com': 'Facebook',
  'apps.instagram.com': 'Instagram',
  'google-play': 'Google Play (organic)',
  google: 'Google',
  '(direct)': 'Direct',
  '(not set)': 'Không rõ',
};
export const sourceLabel = (s: string) => SOURCE_LABELS[s] ?? s;
const SPEND_SOURCES: Record<string, string> = { facebook: 'Facebook', google: 'Google Ads' };
const versionLabel = (v: string) => (v === 'mixed' ? 'Nhiều phiên bản' : v === '?' ? 'Không rõ' : v);

const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`;
const pts = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}`;
const split = (v: string | null) => (v ? v.split(',').filter(Boolean) : []);

/** Retention theo ngày cài từ GA4, chọn cột D0…D60 như Adjust; so sánh 2 khoảng ngày để tìm vì sao tăng/giảm. */
export function RetentionPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const days = params.get('days') ? split(params.get('days')).map(Number).filter((n) => n >= 0) : DEFAULT_DAYS;
  const range = { from: params.get('from') ?? daysAgo(30), to: params.get('to') ?? daysAgo(1) };
  const countries = split(params.get('countries'));
  const versions = split(params.get('versions'));
  const update = (patch: Record<string, string | string[] | number[]>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      const s = Array.isArray(v) ? v.join(',') : v;
      if (s) p.set(k, s);
      else p.delete(k);
    }
    setParams(p, { replace: true });
  };

  const status = useQuery({
    queryKey: ['retention', 'status'],
    queryFn: () => api<RetentionStatus>('/retention/status'),
    refetchInterval: (s) => (s.state.data?.running ? 2000 : false),
  });
  const synced = status.data?.lastSyncedAt;
  const sourceList = useQuery({
    queryKey: ['retention', 'sources', synced],
    queryFn: () => api<{ source: string; newUsers: number }[]>('/retention/sources'),
  });
  // Nguồn mặc định là Google (nếu có dữ liệu Google); chọn "Tất cả" lưu sources=all trên link để không bị đặt lại.
  const sourceParam = params.get('sources');
  const sourcesReady = sourceParam !== null || sourceList.isSuccess;
  const sources = sourceParam === 'all' ? []
    : sourceParam !== null ? split(sourceParam)
    : sourceList.data?.some((x) => x.source === DEFAULT_SOURCE) ? [DEFAULT_SOURCE] : [];
  const segmentQuery = { countries, sources, versions };
  const q = qs({ ...range, ...segmentQuery });
  const versionList = useQuery({
    queryKey: ['retention', 'versions', synced],
    queryFn: () => api<{ version: string; newUsers: number }[]>('/retention/versions'),
  });
  const countryList = useQuery({
    queryKey: ['retention', 'countries', range.from, range.to, synced],
    queryFn: () => api<{ country: string }[]>(`/retention/by-country?${qs(range)}`),
  });
  const rows = useQuery({
    queryKey: ['retention', 'by-date', q, synced],
    queryFn: () => api<RetentionDay[]>(`/retention/by-date?${q}`),
    // Chờ biết nguồn mặc định để không tải bảng 2 lần.
    enabled: sourcesReady,
  });
  const sync = useMutation({
    mutationFn: () => post('/retention/sync', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['retention', 'status'] }),
  });

  const data = rows.data ?? [];
  const sortedDays = [...new Set(days)].sort((a, b) => a - b);
  // Dòng tổng: mỗi mốc chỉ cộng các ngày cài đã đủ mốc đó.
  const total = sortedDays.map((n) => {
    const ready = data.filter((r) => n < r.active.length);
    const users = ready.reduce((s, r) => s + r.newUsers, 0);
    return users ? ready.reduce((s, r) => s + r.active[n], 0) / users : null;
  });
  const totalUsers = data.reduce((s, r) => s + r.newUsers, 0);

  if (status.data && !status.data.enabled) {
    return (
      <>
        <header className="page-header"><h1>Retention</h1></header>
        <div className="notice error">Chưa cấu hình GA4 (GA4_PROPERTY_ID, GA4_KEY_FILE trong .env.server).</div>
      </>
    );
  }

  return (
    <>
      <header className="page-header">
        <h1>Retention</h1>
        <div className="update-box">
          <div className="small muted">
            {status.data?.running ? 'Đang lấy dữ liệu GA4…' : `Cập nhật lần cuối: ${relative(synced ?? null)}`}
            {status.data?.lastError && !status.data.running && (
              <span className="error-text" title={status.data.lastError}> · lỗi</span>
            )}
          </div>
          {can('ADMIN', 'MANAGER') && (
            <button className="primary" disabled={status.data?.running || sync.isPending} onClick={() => sync.mutate()}>
              {status.data?.running ? <span className="spinner" /> : '⟳'} {status.data?.running ? 'Đang cập nhật' : 'Update'}
            </button>
          )}
        </div>
      </header>

      <div className="filters">
        <DateRangePicker from={range.from} to={range.to} onChange={(r) => update(r)} />
        <label>
          Quốc gia
          <SearchSelect value={countries} onChange={(v) => update({ countries: v })} allLabel="Tất cả" placeholder="Gõ tên hoặc mã nước…"
            width={220} options={countryOptions((countryList.data ?? []).map((c) => c.country).filter((c) => c !== 'ZZ'))} />
        </label>
        <label>
          Nguồn
          <SearchSelect value={sources} onChange={(v) => update({ sources: v.length ? v : 'all' })} allLabel="Tất cả" placeholder="Gõ nguồn…" width={200}
            options={(sourceList.data ?? []).map((s) => ({ value: s.source, label: sourceLabel(s.source), keywords: s.source }))} />
        </label>
        <label>
          Phiên bản cài
          <SearchSelect value={versions} onChange={(v) => update({ versions: v })} allLabel="Tất cả" placeholder="Gõ phiên bản…" width={170}
            options={(versionList.data ?? []).map((v) => ({ value: v.version, label: versionLabel(v.version) }))} />
        </label>
        <DayPicker value={sortedDays} max={status.data?.maxDay ?? 60} defaults={DEFAULT_DAYS} extra={EXTRA_DAYS}
          onChange={(d) => update({ days: d })} />
      </div>
      {versions.length > 0 && (
        <p className="small muted">
          Phiên bản cài là phiên bản người dùng dùng trong ngày cài (≥ 90% người dùng của nhóm). GA4 không lưu phiên
          bản lúc cài nên đây là ước tính; nhóm có nhiều phiên bản trong ngày cài nằm ở "Nhiều phiên bản".
        </p>
      )}

      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Ngày cài</th>
              <th className="num">Người dùng mới</th>
              {sortedDays.map((n) => <th key={n} className="num">D{n}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.length > 0 && (
              <tr className="total-row">
                <td><b>Tổng ({data.length} ngày)</b></td>
                <td className="num"><b>{num(totalUsers)}</b></td>
                {total.map((t, i) => <td key={sortedDays[i]} className="num"><b>{t === null ? '—' : pct1(t)}</b></td>)}
              </tr>
            )}
            {data.map((r) => (
              <tr key={r.date}>
                <td>{r.date}</td>
                <td className="num">{num(r.newUsers)}</td>
                {sortedDays.map((n) => (
                  <td key={n} className="num" title={n < r.active.length ? `${num(r.active[n])} người` : 'Chưa đủ ngày'}>
                    {n < r.active.length && r.newUsers ? pct1(r.active[n] / r.newUsers) : <span className="muted">—</span>}
                  </td>
                ))}
              </tr>
            ))}
            {rows.isLoading && <tr><td colSpan={2 + sortedDays.length} className="center muted">Đang tải…</td></tr>}
            {!rows.isLoading && !data.length && (
              <tr><td colSpan={2 + sortedDays.length} className="center muted">
                {synced ? 'Không có dữ liệu' : 'Chưa có dữ liệu. Bấm Update để lấy từ GA4.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <RevenueByInstallTable synced={synced} />

      {sourcesReady && (
        <ComparePanel segmentQuery={segmentQuery} defaultDay={sortedDays.find((d) => d > 0) ?? 1} synced={synced} />
      )}
    </>
  );
}

/** So sánh retention giữa 2 khoảng ngày cài, tách chênh lệch thành "do tỷ trọng nhóm" và "do retention trong nhóm". */
function ComparePanel({ segmentQuery, defaultDay, synced }: {
  segmentQuery: { countries: string[]; sources: string[]; versions: string[] };
  defaultDay: number;
  synced?: string | null;
}) {
  const [a, setA] = useState({ from: daysAgo(28), to: daysAgo(15) });
  const [b, setB] = useState({ from: daysAgo(14), to: daysAgo(1) });
  const [day, setDay] = useState(defaultDay);
  const [by, setBy] = useState<'country' | 'source' | 'version'>('country');
  const q = qs({ aFrom: a.from, aTo: a.to, bFrom: b.from, bTo: b.to, day: String(day), by, ...segmentQuery });
  const result = useQuery({
    queryKey: ['retention', 'compare', q, synced],
    queryFn: () => api<RetentionCompare>(`/retention/compare?${q}`),
  });
  const r = result.data;
  const label = (k: string) => (k === 'other' ? 'Khác'
    : by === 'country' ? (k === 'ZZ' ? 'Không rõ' : `${countryName(k)} (${k})`)
    : by === 'source' ? sourceLabel(k) : versionLabel(k));
  const dimLabel = { country: 'nước', source: 'nguồn', version: 'phiên bản cài' }[by];

  return (
    <>
      <h2>Vì sao retention tăng / giảm?</h2>
      <div className="filters">
        <label>Kỳ trước <DateRangePicker from={a.from} to={a.to} onChange={setA} /></label>
        <label>Kỳ này <DateRangePicker from={b.from} to={b.to} onChange={setB} /></label>
        <label>
          Mốc
          <select value={day} onChange={(e) => setDay(Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6, 7, 14, 30].map((n) => <option key={n} value={n}>D{n}</option>)}
          </select>
        </label>
        <label>
          Theo
          <select value={by} onChange={(e) => setBy(e.target.value as typeof by)}>
            <option value="country">Quốc gia</option>
            <option value="source">Nguồn</option>
            <option value="version">Phiên bản cài</option>
          </select>
        </label>
      </div>

      {result.isLoading && <div className="card center muted">Đang tính…</div>}
      {r && (r.a.rate === null || r.b.rate === null) && (
        <div className="card center muted">Một trong 2 kỳ chưa có ngày cài nào đủ D{day}. Chọn kỳ cũ hơn hoặc mốc nhỏ hơn.</div>
      )}
      {r && r.a.rate !== null && r.b.rate !== null && r.delta !== undefined && (
        <>
          <div className="card compare-summary">
            <p>
              D{day}: <b>{pct1(r.a.rate)}</b> ({num(r.a.users)} người, {r.a.from} → {r.a.to}) →{' '}
              <b>{pct1(r.b.rate)}</b> ({num(r.b.users)} người, {r.b.from} → {r.b.to}){' '}
              <b className={r.delta >= 0 ? 'success-text' : 'error-text'}>{pts(r.delta)} điểm</b>
            </p>
            <p className="small">
              <b className={r.mix! >= 0 ? 'success-text' : 'error-text'}>{pts(r.mix!)} điểm</b> do tỷ trọng {dimLabel} thay đổi
              (nhiều / ít người dùng hơn từ các {dimLabel} có retention cao) ·{' '}
              <b className={r.rateEffect! >= 0 ? 'success-text' : 'error-text'}>{pts(r.rateEffect!)} điểm</b> do retention
              trong từng {dimLabel} thay đổi.
            </p>
            <p className="small muted">
              Chỉ tính ngày cài đã đủ {day} ngày. Nhóm ít người dùng dao động mạnh; cộng các dòng bên dưới ra đúng phần chênh lệch.
            </p>
          </div>
          <div className="card table-card">
            <table>
              <thead>
                <tr>
                  <th>{dimLabel[0].toUpperCase() + dimLabel.slice(1)}</th>
                  <th className="num">Người dùng (trước → này)</th>
                  <th className="num">Tỷ trọng</th>
                  <th className="num">D{day} (trước → này)</th>
                  <th className="num" title="Đóng góp do nhóm này nhiều / ít người dùng hơn">Do tỷ trọng</th>
                  <th className="num" title="Đóng góp do retention của nhóm này thay đổi">Do retention</th>
                  <th className="num">Tổng đóng góp</th>
                </tr>
              </thead>
              <tbody>
                {r.segments.map((s) => {
                  const total = s.mix + s.rateEffect;
                  return (
                    <tr key={s.key}>
                      <td>{label(s.key)}</td>
                      <td className="num">{num(s.usersA)} → {num(s.usersB)}</td>
                      <td className="num">{pct1(s.shareA)} → {pct1(s.shareB)}</td>
                      <td className="num">
                        {s.rateA === null ? '—' : pct1(s.rateA)} → {s.rateB === null ? '—' : pct1(s.rateB)}
                      </td>
                      <td className={`num ${s.mix >= 0 ? 'pos' : 'neg'}`}>{pts(s.mix)}</td>
                      <td className={`num ${s.rateEffect >= 0 ? 'pos' : 'neg'}`}>{pts(s.rateEffect)}</td>
                      <td className={`num ${total >= 0 ? 'pos' : 'neg'}`}><b>{pts(total)}</b></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

/**
 * Doanh thu quảng cáo của từng ngày đến từ người dùng cài ngày nào (GA4). Ngày cài trong khoảng đang xem luôn có cột;
 * ngày cài trước khoảng đó chiếm ≤ 1% tổng doanh thu được gộp vào cột "Trước đó".
 */
function RevenueByInstallTable({ synced }: { synced?: string | null }) {
  const [range, setRange] = useState({ from: daysAgo(13), to: daysAgo(0) });
  const data = useQuery({
    queryKey: ['retention', 'revenue-by-install', range.from, range.to, synced],
    queryFn: () => api<RevenueByInstall>(`/retention/revenue-by-install?${qs(range)}`),
  });
  const r = data.data;
  const shortDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  const label = (c: string) => (c === 'earlier' ? `Trước ${r?.earlierBefore ? shortDate(r.earlierBefore) : ''}` : c === 'unknown' ? 'Không rõ' : shortDate(c));
  const colTotal = (c: string) => r?.rows.reduce((s, row) => s + (row.cells[c]?.revenue ?? 0), 0) ?? 0;
  const grand = r?.rows.reduce((s, row) => s + row.total, 0) ?? 0;
  const spendTotal = r ? Object.values(r.spend).reduce((s, x) => s + x.total, 0) : 0;
  const googleValueTotal = r ? Object.values(r.spend).reduce((s, x) => s + x.googleValue, 0) : 0;
  const spendTitle = (bySource: Record<string, number>) =>
    Object.entries(bySource).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${SPEND_SOURCES[k] ?? k}: ${money(v)}`).join('\n') || undefined;
  const recent = new Set([daysAgo(0), daysAgo(1)]);

  return (
    <>
      <h2>Doanh thu theo ngày cài</h2>
      <p className="small muted">
        Doanh thu quảng cáo của mỗi ngày đến từ người dùng cài ngày nào (GA4, lệch nhẹ so với AdMob). Mỗi ngày cài trong
        khoảng đang xem có 1 cột; người cài trước khoảng đó gộp vào cột "Trước" (ngày nào chiếm trên 1% doanh thu thì vẫn
        tách riêng). Hôm nay và hôm qua chưa đủ số.
      </p>
      <div className="filters">
        <DateRangePicker from={range.from} to={range.to} onChange={setRange} />
      </div>
      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Ngày</th>
              <th className="num col-total">Tổng</th>
              <th className="num" title="Tỷ lệ doanh thu từ người cài trong chính ngày đó">% từ người mới</th>
              {r?.columns.map((c) => <th key={c} className="num">{label(c)}</th>)}
            </tr>
          </thead>
          <tbody>
            {r && r.rows.length > 0 && (
              <tr className="total-row highlight">
                <td><b>Tổng ({r.rows.length} ngày)</b></td>
                <td className="num col-total"><b>{money(grand)}</b></td>
                <td className="num">
                  <b>{grand ? pct1(r.rows.reduce((s, row) => s + (row.cells[row.date]?.revenue ?? 0), 0) / grand) : '—'}</b>
                </td>
                {r.columns.map((c) => <td key={c} className="num"><b>{money(colTotal(c))}</b></td>)}
              </tr>
            )}
            {r && r.rows.length > 0 && (
              <tr className="spend-row" title="Chi phí quảng cáo mọi kênh (Facebook, Google Ads…) trong ngày cài của từng cột">
                <td><b>Spend</b></td>
                <td className="num col-total"><b>{money(spendTotal)}</b></td>
                <td />
                {r.columns.map((c) => {
                  const sp = r.spend[c];
                  return (
                    <td key={c} className="num" title={sp ? spendTitle(sp.bySource) : undefined}>
                      {sp?.total ? money(sp.total) : <span className="muted">—</span>}
                    </td>
                  );
                })}
              </tr>
            )}
            {r && r.rows.length > 0 && (
              <tr className="spend-row" title="Doanh thu Google Ads tự ghi nhận (conversion value) cho ngày cài của từng cột">
                <td>Rev Google Ads ghi nhận</td>
                <td className="num col-total">{money(googleValueTotal)}</td>
                <td />
                {r.columns.map((c) => {
                  const v = r.spend[c]?.googleValue;
                  return <td key={c} className="num">{v ? money(v) : <span className="muted">—</span>}</td>;
                })}
              </tr>
            )}
            {r?.rows.map((row) => (
              <tr key={row.date} className={recent.has(row.date) ? 'roas-partial' : undefined}
                title={recent.has(row.date) ? 'Chưa đủ số: GA4 còn đang xử lý' : undefined}>
                <td>{row.date}</td>
                <td className="num col-total">{money(row.total)}</td>
                <td className="num">{row.total ? pct1((row.cells[row.date]?.revenue ?? 0) / row.total) : '—'}</td>
                {r.columns.map((c) => {
                  const cell = row.cells[c];
                  // Ngày cài sau ngày phát sinh doanh thu: không thể có số.
                  if (c !== 'earlier' && c !== 'unknown' && c > row.date) return <td key={c} className="num muted" />;
                  return (
                    <td key={c} className={`num ${c === row.date ? 'cell-new' : ''}`}
                      title={cell ? `${num(cell.users)} người dùng · ${row.total ? pct1(cell.revenue / row.total) : '—'}` : undefined}>
                      {cell ? money(cell.revenue) : <span className="muted">—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
            {data.isLoading && <tr><td colSpan={3} className="center muted">Đang tải…</td></tr>}
            {!data.isLoading && !r?.rows.length && (
              <tr><td colSpan={3 + (r?.columns.length ?? 0)} className="center muted">
                Chưa có dữ liệu. Bấm Update ở đầu trang để lấy từ GA4.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
