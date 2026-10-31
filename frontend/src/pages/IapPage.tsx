import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, post, qs } from '../api';
import { useAuth } from '../auth';
import { DateRangePicker } from '../components/DateRangePicker';
import { filterQuery, useFilters } from '../components/Filters';
import { SearchSelect } from '../components/SearchSelect';
import { COLORS } from '../components/MonetCharts';
import { compact, countryName, countryOptions, money, num, relative } from '../format';
import type { AppInfo } from '../types';

interface IapAgg {
  gross: number;
  net: number;
  tax: number;
  orders: number;
  refunds: number;
}
interface IapReport {
  byDay: (IapAgg & { date: string })[];
  bySku: (IapAgg & { sku: string; productType: string; fee: number })[];
  byCountry: (IapAgg & { country: string })[];
}
interface IapStatus {
  enabled: boolean;
  running: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
}

const sum = (rows: IapAgg[]) => rows.reduce(
  (s, r) => ({ gross: s.gross + r.gross, net: s.net + r.net, tax: s.tax + r.tax, orders: s.orders + r.orders, refunds: s.refunds + r.refunds }),
  { gross: 0, net: 0, tax: 0, orders: 0, refunds: 0 },
);

/** Các cột số dùng chung cho 3 bảng. */
function AggCells({ a }: { a: IapAgg }) {
  return (
    <>
      <td className="num">{num(a.orders)}</td>
      <td className="num">{a.refunds ? <span className="error-text">{num(a.refunds)}</span> : <span className="muted">—</span>}</td>
      <td className="num muted">{money(a.tax)}</td>
      <td className="num">{money(a.gross)}</td>
      <td className="num col-total"><b>{money(a.net)}</b></td>
    </>
  );
}

function AggHead() {
  return (
    <>
      <th className="num">Đơn</th>
      <th className="num">Hoàn tiền</th>
      <th className="num" title="Thuế VAT/GST Google thu hộ, không phải tiền của bạn">Thuế</th>
      <th className="num" title="Giá người mua trả đã bỏ thuế, đã trừ hoàn tiền">Sau thuế</th>
      <th className="num col-total" title="Ước tính thực nhận: sau thuế trừ phí Google Play">Thực nhận ~</th>
    </>
  );
}

/** Doanh thu mua trong app (Google Play) theo ngày, sản phẩm, nước; dùng chung bộ lọc app / nước / ngày với Monet. */
export function IapPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useFilters();
  const f = filterQuery(filters);
  const q = qs({ from: f.from, to: f.to, appIds: f.appIds, countries: f.countries });
  const apps = useQuery({ queryKey: ['apps'], queryFn: () => api<AppInfo[]>('/admob/apps') });
  const status = useQuery({
    queryKey: ['iap', 'status'],
    queryFn: () => api<IapStatus>('/iap/status'),
    refetchInterval: (s) => (s.state.data?.running ? 2000 : false),
  });
  const data = useQuery({
    queryKey: ['iap', 'report', q, status.data?.lastSyncedAt],
    queryFn: () => api<IapReport>(`/iap/report?${q}`),
  });
  const sync = useMutation({
    mutationFn: () => post('/iap/sync', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['iap', 'status'] }),
  });
  const r = data.data;
  const total = sum(r?.byDay ?? []);
  const selected = filters.appIds[0];

  if (status.data && !status.data.enabled) {
    return (
      <>
        <header className="page-header"><h1>IAP</h1></header>
        <div className="notice error">Chưa cấu hình PLAY_REPORTS_BUCKET trong .env.server.</div>
      </>
    );
  }

  return (
    <>
      <header className="page-header">
        <h1>IAP (mua trong app)</h1>
        <div className="update-box">
          <div className="small muted">
            {status.data?.running ? 'Đang lấy báo cáo Google Play…' : `Cập nhật lần cuối: ${relative(status.data?.lastSyncedAt ?? null)}`}
            {status.data?.lastError && !status.data.running && <span className="error-text" title={status.data.lastError}> · lỗi</span>}
          </div>
          {can('ADMIN', 'MANAGER') && (
            <button className="primary" disabled={status.data?.running || sync.isPending} onClick={() => sync.mutate()}>
              {status.data?.running ? <span className="spinner" /> : '⟳'} Update
            </button>
          )}
        </div>
      </header>
      <p className="small muted">
        Từ báo cáo bán hàng ước tính của Google Play (cập nhật chậm khoảng 1 ngày, CMS lấy 7:15 và 19:15). "Sau thuế" là
        giá người mua trả đã bỏ VAT/GST và trừ hoàn tiền; "Thực nhận ~" là sau thuế trừ phí Google (gói đăng ký 15%,
        mua 1 lần theo cấu hình), số chính xác có trong báo cáo thu nhập hằng tháng.
      </p>

      <div className="filters">
        <label>
          App
          <select value={selected ?? ''} onChange={(e) => setFilters({ appIds: e.target.value ? [e.target.value] : [] })}>
            <option value="">Tất cả app</option>
            {apps.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label>
          Quốc gia
          <SearchSelect value={filters.countries} allLabel="Tất cả" placeholder="Gõ tên hoặc mã nước…" width={220}
            options={countryOptions((r?.byCountry ?? []).map((c) => c.country))} onChange={(countries) => setFilters({ countries })} />
        </label>
        <DateRangePicker from={filters.from} to={filters.to} onChange={setFilters} />
      </div>

      <div className="card compare-summary">
        <p>
          <b>{num(total.orders)}</b> đơn{total.refunds ? <> · <span className="error-text">{num(total.refunds)} hoàn tiền</span></> : ''}
          {' '}· Sau thuế <b>{money(total.gross)}</b> · Thực nhận ~ <b className="success-text">{money(total.net)}</b>
          {' '}· Thuế Google thu hộ {money(total.tax)}
        </p>
      </div>

      <h2>Theo ngày</h2>
      {r && r.byDay.length > 0 && (
        <div className="card">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={[...r.byDay].reverse().map((d) => ({ ...d, fee: d.gross - d.net }))} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#ececec" vertical={false} />
              <XAxis dataKey="date" tickLine={false} tick={{ fill: '#555', fontSize: 11 }} tickFormatter={(d: string) => d.slice(5)} />
              <YAxis tickLine={false} tick={{ fill: '#555', fontSize: 11 }} tickFormatter={compact} width={44} />
              <Tooltip formatter={(v, k) => [money(Number(v)), k === 'net' ? 'Thực nhận ~' : 'Phí Google']}
                contentStyle={{ fontSize: 12 }} />
              <Legend formatter={(k) => <span style={{ fontSize: 11, color: '#444' }}>{k === 'net' ? 'Thực nhận ~' : 'Phí Google'}</span>} />
              {/* Cột chồng: thực nhận + phí Google = sau thuế. */}
              <Bar dataKey="net" stackId="a" fill={COLORS.iap} maxBarSize={48} />
              <Bar dataKey="fee" stackId="a" fill="#d9cdfc" maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="card table-card">
        <table>
          <thead><tr><th>Ngày</th><AggHead /></tr></thead>
          <tbody>
            {r && r.byDay.length > 0 && (
              <tr className="total-row highlight"><td><b>Tổng ({r.byDay.length} ngày)</b></td><AggCells a={total} /></tr>
            )}
            {r?.byDay.map((d) => <tr key={d.date}><td>{d.date}</td><AggCells a={d} /></tr>)}
            {data.isLoading && <tr><td colSpan={6} className="center muted">Đang tải…</td></tr>}
            {!data.isLoading && !r?.byDay.length && <tr><td colSpan={6} className="center muted">Không có đơn nào trong khoảng này.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="iap-grid">
        <section>
          <h2>Theo sản phẩm</h2>
          <div className="card table-card">
            <table>
              <thead><tr><th>Sản phẩm</th><th>Loại</th><th className="num">Phí Google</th><AggHead /></tr></thead>
              <tbody>
                {r?.bySku.map((s) => (
                  <tr key={s.sku}>
                    <td>{s.sku}</td>
                    <td className="small muted">{s.productType}</td>
                    <td className="num muted">{Math.round(s.fee * 100)}%</td>
                    <AggCells a={s} />
                  </tr>
                ))}
                {!data.isLoading && !r?.bySku.length && <tr><td colSpan={8} className="center muted">—</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
        <section>
          <h2>Theo nước</h2>
          <div className="card table-card">
            <table>
              <thead><tr><th>Nước</th><AggHead /></tr></thead>
              <tbody>
                {r?.byCountry.map((c) => (
                  <tr key={c.country}><td>{countryName(c.country)} <span className="muted">({c.country})</span></td><AggCells a={c} /></tr>
                ))}
                {!data.isLoading && !r?.byCountry.length && <tr><td colSpan={6} className="center muted">—</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
