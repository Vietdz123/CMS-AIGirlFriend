import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, qs } from '../api';
import { useAuth } from '../auth';
import { DateRangePicker } from '../components/DateRangePicker';
import { filterQuery, useFilters } from '../components/Filters';
import { IapChart, MiniChart, ProfitOverviewChart } from '../components/MonetCharts';
import { SearchSelect } from '../components/SearchSelect';
import { UpdateButton } from '../components/UpdateButton';
import { countryName, countryOptions, daysAgo, money, num, ratio } from '../format';
import type { AppInfo, IapDetailRow, Summary, TimePoint } from '../types';

/** Giống UNMATCHED ở ReportsService: "app" ảo gom chi phí của chiến dịch chưa ghép được app nào. */
const UNMATCHED = '__unmatched__';

/** Kênh quảng cáo lọc chi phí; "Tất cả" = cộng mọi kênh. */
const CHANNELS = [
  { value: '', label: 'Tất cả kênh' },
  { value: 'google', label: 'Google Ads' },
  { value: 'facebook', label: 'Facebook' },
];

/** Tiền hiện trên trang: USD (mặc định) hoặc VND đổi theo tỷ giá từng ngày (trang Tỷ giá). */
type Currency = 'USD' | 'VND';
const MONEY_FIELDS = ['earnings', 'iapRevenue', 'iapNet', 'totalRevenue', 'spend', 'profit', 'cpi', 'ecpm'] as const;
const vnd = (v: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(v);
const vndShort = (v: number) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(v);

/** VAT Google Ads tại Việt Nam: Google thu thêm 8% trên Cost (= 7,407% số tiền nạp). */
const GOOGLE_VAT = 0.08;

const IAP_GROSS_TITLE = 'Mua trong app (Google Play): giá người mua trả đã bỏ thuế VAT/GST, đã trừ hoàn tiền, chưa trừ phí Google';
const IAP_NET_TITLE = 'Ước tính thực nhận: IAP sau thuế trừ phí Google Play 15%. Số chính xác có trong báo cáo thu nhập hằng tháng của Google';

const usd = (v: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const cents = (v: number) => v.toFixed(2);

/** Doanh thu quảng cáo vs chi phí UA theo ngày, cho 1 app hoặc tất cả. */
export function MonetPage() {
  const { can } = useAuth();
  const [filters, setFilters] = useFilters();
  // Thuế Google Ads: Cost trên Google Ads chưa gồm VAT 8%; bật thì chi phí Google x 1.08. Mặc định tắt.
  const [withVat, setWithVat] = useState(() => localStorage.getItem('monet-gads-vat') === 'on');
  useEffect(() => localStorage.setItem('monet-gads-vat', withVat ? 'on' : 'off'), [withVat]);
  // Chỉ trang này có ô chọn kênh / thuế nên chỉ trang này gửi spendSources, googleVat.
  const q = qs({
    ...filterQuery(filters),
    spendSources: filters.spendSources,
    googleVat: withVat ? String(GOOGLE_VAT) : undefined,
  });
  const apps = useQuery({ queryKey: ['apps'], queryFn: () => api<AppInfo[]>('/admob/apps') });
  const options = useQuery({
    queryKey: ['reports', 'filters'],
    queryFn: () => api<{ formats: string[]; countries: string[] }>('/reports/filters'),
  });
  const summary = useQuery({ queryKey: ['reports', 'summary', q], queryFn: () => api<Summary>(`/reports/summary?${q}`) });
  const series = useQuery({
    queryKey: ['reports', 'timeseries', q],
    queryFn: () => api<TimePoint[]>(`/reports/timeseries?${q}&granularity=day`),
  });

  // Bật = Profit / ROAS / Total Revenue cộng IAP thực nhận; tắt = chỉ doanh thu quảng cáo.
  const [withIap, setWithIap] = useState(() => localStorage.getItem('monet-iap') !== 'off');
  useEffect(() => localStorage.setItem('monet-iap', withIap ? 'on' : 'off'), [withIap]);
  const [currency, setCurrency] = useState<Currency>(() => (localStorage.getItem('monet-currency') as Currency) || 'USD');
  useEffect(() => localStorage.setItem('monet-currency', currency), [currency]);
  const fx = useQuery({
    queryKey: ['fx', 'rates', 'VND', filters.from, filters.to],
    queryFn: () => api<{ date: string; rate: number }[]>(`/fx/rates?${qs({ currency: 'VND', from: filters.from, to: filters.to })}`),
    enabled: currency === 'VND',
  });
  const rateOf = new Map((fx.data ?? []).map((r) => [r.date, r.rate]));
  const fallbackRate = fx.data?.[0]?.rate ?? 0;
  const toLocal = currency === 'VND' && !!fx.data;
  // Đổi tiền từng ngày theo tỷ giá ngày đó; ROAS và số lượt giữ nguyên.
  const dropIap = <T extends { earnings: number; iapNet: number; spend: number; totalRevenue: number; profit: number; roas: number }>(d: T): T =>
    withIap ? d : { ...d, totalRevenue: d.earnings, profit: d.earnings - d.spend, roas: d.spend ? d.earnings / d.spend : 0 };
  const data = (series.data ?? []).map((d0) => {
    const d = dropIap(d0);
    if (!toLocal) return d;
    const r = rateOf.get(d.date) ?? fallbackRate;
    const out = { ...d };
    for (const k of MONEY_FIELDS) out[k] = d[k] * r;
    return out;
  });
  // Tổng khi xem VND = tổng các ngày đã đổi (không dùng 1 tỷ giá cho cả khoảng).
  const sum = (k: 'earnings' | 'iapRevenue' | 'iapNet' | 'totalRevenue' | 'spend' | 'profit' | 'installs') => data.reduce((s, d) => s + d[k], 0);
  const curRaw = summary.data?.current && dropIap(summary.data.current);
  const cur = curRaw && toLocal
    ? {
        ...curRaw, earnings: sum('earnings'), iapRevenue: sum('iapRevenue'), iapNet: sum('iapNet'), totalRevenue: sum('totalRevenue'),
        spend: sum('spend'), profit: sum('profit'), cpi: sum('installs') ? sum('spend') / sum('installs') : 0,
      }
    : curRaw;
  const m = toLocal ? vnd : money;
  // Gói IAP theo ngày cho tooltip của biểu đồ IAP (cùng khoảng ngày / app / nước với trang).
  const iapDetail = useQuery({
    queryKey: ['iap', 'report', qs({ from: filters.from, to: filters.to, appIds: filters.appIds, countries: filters.countries })],
    queryFn: () => api<{ detail: IapDetailRow[] }>(
      `/iap/report?${qs({ from: filters.from, to: filters.to, appIds: filters.appIds, countries: filters.countries })}`,
    ),
  });
  const channelLabel = CHANNELS.find((c) => c.value && c.value === filters.spendSources[0])?.label;
  const selected = filters.appIds[0];
  // Chỉ admin xem được nhóm chưa ghép app (server chặn với Viewer/Manager); hiện tab khi có số hoặc đang chọn.
  const [unmatchedSeen, setUnmatchedSeen] = useState(false);
  const unmatched = summary.data?.unmatchedSpend ?? 0;
  useEffect(() => {
    if (unmatched > 0) setUnmatchedSeen(true);
  }, [unmatched]);
  const showUnmatchedTab = can('ADMIN') && (unmatchedSeen || selected === UNMATCHED);

  return (
    <div className="monet">
      <div className="monet-tabs">
        <button className={!selected ? 'active' : ''} onClick={() => setFilters({ appIds: [] })}>Tất cả app</button>
        {apps.data?.map((a) => (
          <button key={a.id} className={selected === a.id ? 'active' : ''} onClick={() => setFilters({ appIds: [a.id] })}>
            {a.name}
          </button>
        ))}
        {showUnmatchedTab && (
          <button className={`unmatched ${selected === UNMATCHED ? 'active' : ''}`}
            title="Chi phí của chiến dịch Facebook / Google Ads chưa ghép được với app AdMob nào"
            onClick={() => setFilters({ appIds: [UNMATCHED] })}>
            Chưa ghép app
          </button>
        )}
      </div>
      {selected === UNMATCHED && (
        <div className="notice info small">
          Chi phí của các chiến dịch có package không thuộc app AdMob nào (không có doanh thu tương ứng).
          Ghép chiến dịch với app ở bảng <b>Chiến dịch → App</b> trên trang Google Ads / Facebook Ads.
        </div>
      )}

      <div className="monet-toolbar">
        <SearchSelect value={filters.countries} allLabel="Country" placeholder="Gõ tên hoặc mã nước…" width={240}
          options={countryOptions(options.data?.countries ?? [])}
          onChange={(countries) => setFilters({ countries })} />
        <select value={filters.spendSources[0] ?? ''} title="Kênh tính Spend, Install, CPI, Profit, ROAS (Revenue AdMob không đổi)"
          onChange={(e) => setFilters({ spendSources: e.target.value ? [e.target.value] : [] })}>
          {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <DateRangePicker from={filters.from} to={filters.to} onChange={setFilters} />
        <button className="clear" onClick={() => setFilters({ countries: [], spendSources: [], from: daysAgo(6), to: daysAgo(0) })}>Clear</button>
        <div className="spacer" />
        <label className="inline small"
          title="Cost trên Google Ads chưa gồm VAT 8%. Bật: chi phí Google Ads x 1,08 (8% thuế = 7,407% số tiền nạp) trong Spend, Profit, ROAS, CPI">
          <input type="checkbox" checked={withVat} onChange={(e) => setWithVat(e.target.checked)} /> Tính thuế Google Ads (8%)
        </label>
        <label className="inline small" title="Bật: Profit, ROAS, Total Revenue cộng IAP thực nhận ước tính. Tắt: chỉ doanh thu quảng cáo">
          <input type="checkbox" checked={withIap} onChange={(e) => setWithIap(e.target.checked)} /> Tính IAP vào Profit
        </label>
        <div className="seg" title="Đơn vị tiền: VND đổi theo tỷ giá từng ngày (sửa ở trang Tỷ giá)">
          {(['USD', 'VND'] as const).map((c) => (
            <button key={c} className={currency === c ? 'active' : ''} onClick={() => setCurrency(c)}>{c}</button>
          ))}
        </div>
        <UpdateButton />
      </div>

      <div className="monet-body">
        <section className="monet-main">
          <h3>General Statistics</h3>
          {series.isLoading || (currency === 'VND' && fx.isLoading)
            ? <div className="chart-placeholder">Đang tải…</div>
            : <ProfitOverviewChart data={data} currency={toLocal ? 'VND' : 'USD'} fmt={m} withIap={withIap} />}
          {cur && (
            <div className="monet-totals">
              <span>Ads Revenue <b>{m(cur.earnings)}</b></span>
              <span title={IAP_GROSS_TITLE}>IAP (sau thuế) <b>{m(cur.iapRevenue)}</b></span>
              <span title={IAP_NET_TITLE}>IAP thực nhận ~ <b>{m(cur.iapNet)}</b></span>
              <span title={withIap ? 'Ads Revenue + IAP thực nhận ước tính; Profit và ROAS tính trên số này' : 'Chỉ doanh thu quảng cáo (đang tắt IAP)'}>
                Total Revenue{!withIap && <span className="muted"> (không IAP)</span>} <b>{m(cur.totalRevenue)}</b>
              </span>
              <span>
                Spend{channelLabel && <span className="muted"> ({channelLabel})</span>}
                {withVat && <span className="muted"> (gồm VAT Google 8%)</span>} <b>{m(cur.spend)}</b>
              </span>
              <span>Profit <b className={cur.profit < 0 ? 'neg' : 'pos'}>{m(cur.profit)}</b></span>
              <span>ROAS <b>{cur.spend ? ratio(cur.roas) : '—'}</b></span>
            </div>
          )}
          {!selected && unmatched > 0 && cur && (
            <p className="small muted unmatched-note">
              Spend gồm <b>{money(unmatched)}</b> chưa ghép app nào ({money((curRaw?.spend ?? 0) - unmatched)} của các app).
              {' '}
              <button className="link" onClick={() => setFilters({ appIds: [UNMATCHED] })}>Xem chi tiết</button>
            </p>
          )}
        </section>

        {cur && !series.isLoading && (
          <div className="monet-grid">
            <MiniChart title="Install" statLabel="Total" stat={cur.installs} data={data} field="installs" fmt={num} />
            <MiniChart title={`Spend(${toLocal ? 'VND' : 'USD'})`} statLabel="Total" stat={cur.spend} data={data} field="spend" fmt={toLocal ? vndShort : usd} />
            <MiniChart title={`CPI(${toLocal ? 'VND' : 'USD'})`} statLabel="Avg" stat={cur.cpi} data={data} field="cpi"
              fmt={toLocal ? vndShort : cents} axisFmt={toLocal ? undefined : cents} />
            <MiniChart title="ADS Revenue" statLabel="Total" stat={cur.earnings} data={data} field="earnings" fmt={toLocal ? vndShort : usd} />
            <IapChart data={data} detail={iapDetail.data?.detail ?? []} fmt={toLocal ? vndShort : usd}
              stat={{ net: cur.iapNet, orders: cur.iapOrders }} />
            <MiniChart title={`Total Revenue (${toLocal ? 'VND' : 'USD'})`} statLabel="Total" stat={cur.totalRevenue} data={data}
              field="totalRevenue" fmt={toLocal ? vndShort : usd} />
            <MiniChart title="ROAS" statLabel="Avg" stat={cur.roas} data={data} field="roas" fmt={ratio} axisFmt={cents} />
            <MiniChart title={`Profit (${toLocal ? 'VND' : 'USD'})`} statLabel="Total" stat={cur.profit} data={data} field="profit"
              fmt={toLocal ? vndShort : usd} signed />
          </div>
        )}

        <IapPackagesTable pageRange={{ from: filters.from, to: filters.to }} appIds={filters.appIds} countries={filters.countries}
          currency={currency} fmt={m} />

        <section className="monet-table">
          <h3>Theo ngày</h3>
          <table>
            <thead>
              <tr>
                <th>Ngày</th>
                <th className="num">Ads Revenue</th>
                <th className="num" title={IAP_GROSS_TITLE}>IAP (sau thuế)</th>
                <th className="num" title={IAP_NET_TITLE}>IAP thực nhận ~</th>
                <th className="num">Spend</th>
                <th className="num">Profit</th>
                <th className="num">ROAS</th>
                <th className="num">Install</th>
                <th className="num">CPI</th>
                <th className="num">eCPM</th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((d) => (
                <tr key={d.date}>
                  <td>{d.date}</td>
                  <td className="num">{m(d.earnings)}</td>
                  <td className="num">{d.iapRevenue ? m(d.iapRevenue) : <span className="muted">—</span>}</td>
                  <td className="num">{d.iapRevenue ? m(d.iapNet) : <span className="muted">—</span>}</td>
                  <td className="num">{m(d.spend)}</td>
                  <td className={`num ${d.profit < 0 ? 'neg' : ''}`}>{m(d.profit)}</td>
                  <td className="num">{d.spend ? ratio(d.roas) : '—'}</td>
                  <td className="num">{num(d.installs)}</td>
                  <td className="num">{d.installs ? m(d.cpi) : '—'}</td>
                  <td className="num">{m(d.ecpm)}</td>
                </tr>
              ))}
              {!data.length && <tr><td colSpan={10} className="center muted">Không có dữ liệu</td></tr>}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

/** Tiền theo đơn vị người mua trả (ví dụ ¥7.909, 503,20 kr). */
const localPrice = (v: number, currency: string) => {
  try {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(v);
  } catch {
    return `${v.toFixed(2)} ${currency}`;
  }
};

/**
 * Bảng quản lý gói IAP: mỗi dòng là 1 ngày x nước mua x gói, kèm giá người mua trả (tiền gốc), số đơn, hoàn tiền,
 * doanh thu sau thuế và thực nhận ước tính. Lọc được theo gói và nước, theo cùng app / nước / ngày của trang.
 */
function IapPackagesTable({ pageRange, appIds, countries: pageCountries, currency, fmt }: {
  /** Khoảng ngày của trang; bảng dùng mặc định theo đây cho tới khi chọn ngày riêng. */
  pageRange: { from: string; to: string };
  appIds: string[];
  countries: string[];
  currency: Currency;
  fmt: (v: number) => string;
}) {
  const [own, setOwn] = useState<{ from: string; to: string } | null>(null);
  const range = own ?? pageRange;
  const query = qs({ ...range, appIds, countries: pageCountries });
  const data = useQuery({
    queryKey: ['iap', 'report', query],
    queryFn: () => api<{ detail: IapDetailRow[] }>(`/iap/report?${query}`),
  });
  // Tỷ giá theo đúng khoảng ngày của bảng (có thể khác khoảng ngày của trang).
  const fx = useQuery({
    queryKey: ['fx', 'rates', 'VND', range.from, range.to],
    queryFn: () => api<{ date: string; rate: number }[]>(`/fx/rates?${qs({ currency: 'VND', ...range })}`),
    enabled: currency === 'VND',
  });
  const rates = new Map((fx.data ?? []).map((r) => [r.date, r.rate]));
  const rateOf = currency === 'VND' && fx.data ? (d: string) => rates.get(d) ?? fx.data![0]?.rate ?? 0 : null;
  const [sku, setSku] = useState<string[]>([]);
  const [country, setCountry] = useState<string[]>([]);
  const all = data.data?.detail ?? [];
  const rows = all.filter((r) => (!sku.length || sku.includes(r.sku)) && (!country.length || country.includes(r.country)));
  const conv = (v: number, date: string) => (rateOf ? v * rateOf(date) : v);
  const total = rows.reduce(
    (s, r) => ({
      orders: s.orders + r.orders, refunds: s.refunds + r.refunds,
      gross: s.gross + conv(r.gross, r.date), net: s.net + conv(r.net, r.date),
    }),
    { orders: 0, refunds: 0, gross: 0, net: 0 },
  );
  const skus = [...new Set(all.map((r) => r.sku))].sort();
  const countries = [...new Set(all.map((r) => r.country))];

  return (
    <section className="iap-card">
      <div className="iap-card-head">
        <div>
          <h3>Gói IAP</h3>
          <div className="iap-chips">
            <span><b>{num(total.orders)}</b> đơn</span>
            {total.refunds > 0 && <span className="error-text"><b>{num(total.refunds)}</b> hoàn tiền</span>}
            <span>Sau thuế <b>{fmt(total.gross)}</b></span>
            <span>Thực nhận ~ <b className="success-text">{fmt(total.net)}</b></span>
          </div>
        </div>
        <div className="iap-card-filters">
          <DateRangePicker from={range.from} to={range.to} onChange={setOwn} />
          {own && <button className="link" onClick={() => setOwn(null)}>Theo ngày của trang</button>}
          <SearchSelect value={sku} onChange={setSku} allLabel="Tất cả gói" placeholder="Gõ tên gói…" width={220}
            options={skus.map((s) => ({ value: s, label: s }))} />
          <SearchSelect value={country} onChange={setCountry} allLabel="Tất cả nước" placeholder="Gõ tên hoặc mã nước…" width={200}
            options={countryOptions(countries)} />
        </div>
      </div>
      {/* Chỉ bảng cuộn ngang; bộ lọc ở ngoài để popup không bị cắt khi bảng ít dòng. */}
      <div className="iap-scroll">
      <table>
        <thead>
          <tr>
            <th>Ngày</th>
            <th>Nước mua</th>
            <th>Gói</th>
            <th>Loại</th>
            <th className="num">Đơn</th>
            <th className="num">Hoàn tiền</th>
            <th className="num" title="Giá người mua trả (tiền của họ), đã bỏ thuế">Giá (tiền người mua)</th>
            <th className="num" title="Đã bỏ thuế VAT/GST, đã trừ hoàn tiền">Rev sau thuế</th>
            <th className="num" title="Sau thuế trừ phí Google Play">Thực nhận ~</th>
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 && (
            <tr className="total-row highlight">
              <td colSpan={4}><b>Tổng ({rows.length} dòng)</b></td>
              <td className="num"><b>{num(total.orders)}</b></td>
              <td className="num"><b>{total.refunds ? num(total.refunds) : '—'}</b></td>
              <td />
              <td className="num"><b>{fmt(total.gross)}</b></td>
              <td className="num col-total"><b>{fmt(total.net)}</b></td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={`${r.date}|${r.country}|${r.sku}`}>
              <td>{r.date}</td>
              <td>{countryName(r.country)} <span className="muted">({r.country})</span></td>
              <td>{r.sku}</td>
              <td className="small muted">{r.productType}</td>
              <td className="num">{num(r.orders)}</td>
              <td className="num">{r.refunds ? <span className="error-text">{num(r.refunds)}</span> : <span className="muted">—</span>}</td>
              <td className="num muted">{localPrice(r.priceLocal, r.currency)}</td>
              <td className="num">{fmt(conv(r.gross, r.date))}</td>
              <td className="num col-total">{fmt(conv(r.net, r.date))}</td>
            </tr>
          ))}
          {data.isLoading && <tr><td colSpan={9} className="center muted">Đang tải…</td></tr>}
          {!data.isLoading && !rows.length && <tr><td colSpan={9} className="center muted">Không có đơn IAP nào trong khoảng này.</td></tr>}
        </tbody>
      </table>
      </div>
    </section>
  );
}
