import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api, qs } from '../api';
import { DateRangePicker } from '../components/DateRangePicker';
import { SearchSelect } from '../components/SearchSelect';
import { UpdateButton } from '../components/UpdateButton';
import { compact, countryName, countryOptions, daysAgo, fold, formatName, money, num, pct } from '../format';
import type { AppInfo } from '../types';

/** Chiều phân tích, cùng key với ExploreService ở backend. */
const DIMENSIONS = [
  { key: 'date', label: 'Date' },
  { key: 'account', label: 'AdMob Account' },
  { key: 'app', label: 'App' },
  { key: 'adUnit', label: 'Ad unit' },
  { key: 'format', label: 'Format' },
  { key: 'adSource', label: 'Ad Source' },
  { key: 'country', label: 'Country' },
  { key: 'appVersion', label: 'App Version' },
] as const;
type Dim = (typeof DIMENSIONS)[number]['key'];

/** App chọn sẵn khi mở trang (package name trên Google Play). */
const DEFAULT_APP_STORE_ID = 'com.muchie.ai.chat';

const FORMATS = ['BANNER', 'INTERSTITIAL', 'REWARDED', 'REWARDED_INTERSTITIAL', 'NATIVE', 'APP_OPEN'];

interface ExploreRow {
  date?: string;
  account?: string;
  app?: string;
  appName?: string;
  adUnit?: string;
  adUnitName?: string;
  format?: string;
  adSource?: string;
  adSourceName?: string;
  country?: string;
  appVersion?: string;
  earnings: number;
  impressions: number;
  clicks: number;
  adRequests: number;
  matchedRequests: number;
  ecpm: number;
  matchRate: number;
  showRate: number;
  ctr: number;
}
type Metric = 'earnings' | 'ecpm' | 'adRequests' | 'matchRate' | 'matchedRequests' | 'showRate' | 'impressions' | 'ctr' | 'clicks';

interface ExploreResult {
  rows: ExploreRow[];
  totalRows: number;
  truncated: boolean;
  totals: Omit<ExploreRow, Dim>;
}

interface Options {
  adUnits: { value: string; label: string }[];
  adSources: { value: string; label: string }[];
  appVersions: { value: string; label: string }[];
  countries: { value: string; label: string }[];
}

const METRICS: { key: Metric; label: string; fmt: (v: number) => string }[] = [
  { key: 'earnings', label: 'Revenue (USD)', fmt: money },
  { key: 'ecpm', label: 'eCPM (USD)', fmt: money },
  { key: 'adRequests', label: 'Requests', fmt: num },
  { key: 'matchRate', label: 'Match rate', fmt: pct },
  { key: 'matchedRequests', label: 'Matched requests', fmt: num },
  { key: 'showRate', label: 'Show rate', fmt: pct },
  { key: 'impressions', label: 'Impressions', fmt: num },
  { key: 'ctr', label: 'CTR', fmt: pct },
  { key: 'clicks', label: 'Clicks', fmt: num },
];

/** Nhãn hiển thị của 1 ô dimension. */
function cell(r: ExploreRow, d: Dim): string {
  switch (d) {
    case 'date': return r.date ?? '';
    case 'account': return r.account ?? '';
    case 'app': return r.appName ?? r.app ?? '';
    case 'adUnit': return r.adUnitName ?? r.adUnit ?? '';
    case 'format': return formatName(r.format ?? '');
    case 'adSource': return r.adSourceName ?? r.adSource ?? '';
    case 'country': return r.country ? `${countryName(r.country)} (${r.country})` : '';
    case 'appVersion': return r.appVersion ?? '';
  }
}

/** Giá trị để sắp xếp theo dimension (ngày/version sắp theo chuỗi gốc). */
const sortValue = (r: ExploreRow, d: Dim) => (d === 'date' ? r.date ?? '' : cell(r, d));

/**
 * Bảng phân tích chi tiết kiểu báo cáo AdMob: tự chọn các chiều (Date, App, Ad unit, Ad source, Country,
 * App version…), lọc nhiều giá trị, bấm Apply mới tải. Số liệu lấy trực tiếp từ AdMob API.
 */
export function BreakdownPage() {
  const apps = useQuery({ queryKey: ['apps'], queryFn: () => api<AppInfo[]>('/admob/apps') });

  // Bộ lọc đang chỉnh (draft) và bộ lọc đã Apply (applied) tách riêng: chỉ gọi API khi bấm Apply.
  const [draft, setDraft] = useState({
    from: daysAgo(3),
    to: daysAgo(0),
    dimensions: ['adUnit'] as Dim[],
    appIds: [] as string[],
    adUnitIds: [] as string[],
    adSourceIds: [] as string[],
    appVersions: [] as string[],
    countries: [] as string[],
    formats: [] as string[],
  });
  const [applied, setApplied] = useState(draft);
  const set = (patch: Partial<typeof draft>) => setDraft((d) => ({ ...d, ...patch }));

  // Mặc định chọn app Muchie (nếu user xem được) khi danh sách app tải xong; chỉ 1 lần, không ghi đè lựa chọn của user.
  const [defaulted, setDefaulted] = useState(false);
  useEffect(() => {
    if (defaulted || !apps.data) return;
    setDefaulted(true);
    const muchie = apps.data.find((a) => a.storeId === DEFAULT_APP_STORE_ID) ?? apps.data.find((a) => /muchie/i.test(a.name));
    if (!muchie || draft.appIds.length) return;
    const next = { ...draft, appIds: [muchie.id] };
    setDraft(next);
    setApplied(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apps.data]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);

  const q = qs({ ...applied, dimensions: applied.dimensions });
  const report = useQuery({
    queryKey: ['reports', 'explore', q],
    queryFn: () => api<ExploreResult>(`/reports/explore?${q}`),
    // Đợi chọn app mặc định xong để không tải báo cáo mọi app 1 lần thừa.
    enabled: applied.dimensions.length > 0 && (defaulted || apps.isError),
    staleTime: 5 * 60_000,
  });
  // Giá trị cho các ô lọc theo khoảng ngày + app đang chọn.
  const optQ = qs({ from: draft.from, to: draft.to, appIds: draft.appIds });
  const options = useQuery({
    queryKey: ['reports', 'explore-options', optQ],
    queryFn: () => api<Options>(`/reports/explore/options?${optQ}`),
    enabled: defaulted || apps.isError,
    staleTime: 5 * 60_000,
  });

  const [sort, setSort] = useState<{ key: Metric | Dim; desc: boolean }>({ key: 'earnings', desc: true });
  const [search, setSearch] = useState('');
  const dims = applied.dimensions;

  const rows = useMemo(() => {
    const all = report.data?.rows ?? [];
    const needle = fold(search.trim());
    const filtered = needle ? all.filter((r) => fold(dims.map((d) => `${cell(r, d)} ${r[d] ?? ''}`).join(' ')).includes(needle)) : all;
    const isDim = (k: string): k is Dim => DIMENSIONS.some((d) => d.key === k);
    return [...filtered].sort((a, b) => {
      const dir = sort.desc ? -1 : 1;
      if (isDim(sort.key)) return dir * sortValue(a, sort.key).localeCompare(sortValue(b, sort.key), 'vi', { numeric: true });
      return dir * (a[sort.key] - b[sort.key]);
    });
  }, [report.data, search, sort, dims]);

  const sortBy = (key: Metric | Dim) => setSort((s) => ({ key, desc: s.key === key ? !s.desc : !DIMENSIONS.some((d) => d.key === key) }));
  const arrow = (key: Metric | Dim) => (sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : ' ⇅');
  const totals = report.data?.totals;

  return (
    <>
      <header className="page-header">
        <h1>Phân tích chi tiết</h1>
        <UpdateButton />
      </header>

      <div className="explore-filters card">
        <DateRangePicker from={draft.from} to={draft.to} onChange={set} />
        <SearchSelect value={draft.dimensions} allLabel="Select dimensions" placeholder="Chọn dimension…" width={220}
          options={DIMENSIONS.map((d) => ({ value: d.key, label: d.label }))}
          onChange={(v) => set({ dimensions: DIMENSIONS.map((d) => d.key).filter((k) => v.includes(k)) })} />
        <SearchSelect value={draft.appIds} allLabel="Select App" placeholder="Gõ tên app…" width={200}
          options={(apps.data ?? []).map((a) => ({ value: a.id, label: a.name, keywords: a.storeId ?? '' }))}
          onChange={(appIds) => set({ appIds, adUnitIds: [] })} />
        <SearchSelect value={draft.adUnitIds} allLabel="Select Ad Unit" placeholder="Gõ tên ad unit…" width={200}
          options={(options.data?.adUnits ?? []).map((o) => ({ ...o, keywords: o.value }))}
          onChange={(adUnitIds) => set({ adUnitIds })} />
        <SearchSelect value={draft.formats} allLabel="Select Format" width={170}
          options={FORMATS.map((f) => ({ value: f, label: formatName(f) }))}
          onChange={(formats) => set({ formats })} />
        <SearchSelect value={draft.adSourceIds} allLabel="Select Ad Source" placeholder="Gõ tên mạng…" width={190}
          options={options.data?.adSources ?? []}
          onChange={(adSourceIds) => set({ adSourceIds })} />
        <SearchSelect value={draft.appVersions} allLabel="Select App Version" placeholder="Gõ version…" width={190}
          options={options.data?.appVersions ?? []}
          onChange={(appVersions) => set({ appVersions })} />
        <SearchSelect value={draft.countries} allLabel="Select Country" placeholder="Gõ tên hoặc mã nước…" width={200}
          options={countryOptions((options.data?.countries ?? []).map((c) => c.value))}
          onChange={(countries) => set({ countries })} />
        <button className="primary" disabled={!draft.dimensions.length || (!dirty && report.isFetching)}
          onClick={() => (dirty ? setApplied(draft) : report.refetch())}>
          Apply
        </button>
      </div>

      <div className="table-search">
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm trong bảng…" />
        {report.data && (
          <span className="small muted">
            {rows.length.toLocaleString()} dòng
            {report.data.truncated && ` (hiện ${report.data.rows.length.toLocaleString()} / ${report.data.totalRows.toLocaleString()} dòng doanh thu cao nhất, hãy lọc thêm)`}
          </span>
        )}
        {report.isFetching && <span className="small muted"><span className="spinner dark" /> Đang lấy dữ liệu từ AdMob…</span>}
        {dirty && !report.isFetching && <span className="small warn-text">Bộ lọc đã thay đổi, bấm Apply để cập nhật</span>}
      </div>

      {!applied.dimensions.length ? (
        <div className="card center muted">Chọn ít nhất 1 dimension rồi bấm Apply.</div>
      ) : report.error ? (
        <div className="notice error">{report.error.message}</div>
      ) : (
        <div className="card table-card explore-table">
          <table>
            <thead>
              <tr>
                {dims.map((d) => (
                  <th key={d} className="sortable" onClick={() => sortBy(d)}>
                    {DIMENSIONS.find((x) => x.key === d)!.label}{arrow(d)}
                  </th>
                ))}
                {METRICS.map((m) => (
                  <th key={m.key} className={`num sortable ${sort.key === m.key ? 'sorted' : ''}`} onClick={() => sortBy(m.key)}>
                    {m.label}{arrow(m.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {totals && rows.length > 0 && !search && (
                <tr className="total-row">
                  <td colSpan={dims.length}><b>Tổng</b></td>
                  {METRICS.map((m) => <td key={m.key} className="num"><b>{m.fmt(totals[m.key])}</b></td>)}
                </tr>
              )}
              {rows.map((r, i) => (
                <tr key={i}>
                  {dims.map((d) => (
                    <td key={d} className="label-cell" title={r[d] ?? ''}>{cell(r, d)}</td>
                  ))}
                  {METRICS.map((m) => (
                    <td key={m.key} className={`num ${sort.key === m.key ? 'sorted' : ''}`}>
                      {m.key === 'adRequests' && r.adRequests >= 1e7 ? compact(r.adRequests) : m.fmt(r[m.key])}
                    </td>
                  ))}
                </tr>
              ))}
              {!report.isLoading && rows.length === 0 && (
                <tr><td colSpan={dims.length + METRICS.length} className="center muted">Không có dữ liệu</td></tr>
              )}
              {report.isLoading && (
                <tr><td colSpan={dims.length + METRICS.length} className="center muted">Đang tải…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
