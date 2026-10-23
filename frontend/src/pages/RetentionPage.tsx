import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, post, qs } from '../api';
import { useAuth } from '../auth';
import { DateRangePicker } from '../components/DateRangePicker';
import { SearchSelect } from '../components/SearchSelect';
import { countryName, countryOptions, daysAgo, num, relative } from '../format';
import type { RetentionCompare, RetentionDay, RetentionStatus } from '../types';

const DEFAULT_DAYS = [1, 3, 7, 14];
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
  const sources = split(params.get('sources'));
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
  const segmentQuery = { countries, sources, versions };
  const q = qs({ ...range, ...segmentQuery });

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
          <SearchSelect value={sources} onChange={(v) => update({ sources: v })} allLabel="Tất cả" placeholder="Gõ nguồn…" width={200}
            options={(sourceList.data ?? []).map((s) => ({ value: s.source, label: sourceLabel(s.source), keywords: s.source }))} />
        </label>
        <label>
          Phiên bản cài
          <SearchSelect value={versions} onChange={(v) => update({ versions: v })} allLabel="Tất cả" placeholder="Gõ phiên bản…" width={170}
            options={(versionList.data ?? []).map((v) => ({ value: v.version, label: versionLabel(v.version) }))} />
        </label>
        <DayPicker value={sortedDays} max={status.data?.maxDay ?? 60} onChange={(d) => update({ days: d })} />
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

      <ComparePanel segmentQuery={segmentQuery} defaultDay={sortedDays.find((d) => d > 0) ?? 1} synced={synced} />
    </>
  );
}

/** Chọn mốc DN hiển thị: D0…D30 từng ngày, thêm D40/D45/D60. */
function DayPicker({ value, max, onChange }: { value: number[]; max: number; onChange: (days: number[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const options = [...Array.from({ length: 31 }, (_, i) => i), ...EXTRA_DAYS].filter((n) => n <= max);
  const toggle = (n: number) => onChange(value.includes(n) ? value.filter((x) => x !== n) : [...value, n]);
  return (
    <div className="day-picker" ref={ref}>
      <button type="button" onClick={() => setOpen(!open)}>Cột: {value.map((n) => `D${n}`).join(' · ') || '—'} ▾</button>
      {open && (
        <div className="day-picker-pop">
          <div className="day-picker-head">
            <span className="small muted">Chọn ngày hiển thị</span>
            <button type="button" className="link" onClick={() => onChange(DEFAULT_DAYS)}>Mặc định</button>
          </div>
          <div className="day-grid">
            {options.map((n) => (
              <button key={n} type="button" className={value.includes(n) ? 'chip active' : 'chip'} onClick={() => toggle(n)}>
                D{n}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
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
