import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, qs } from '../api';
import { useAuth } from '../auth';
import { DateRangePicker } from '../components/DateRangePicker';
import { filterQuery, useFilters } from '../components/Filters';
import { MiniChart, ProfitOverviewChart } from '../components/MonetCharts';
import { SearchSelect } from '../components/SearchSelect';
import { UpdateButton } from '../components/UpdateButton';
import { countryOptions, daysAgo, money, num, ratio } from '../format';
import type { AppInfo, Summary, TimePoint } from '../types';

/** Giống UNMATCHED ở ReportsService: "app" ảo gom chi phí của chiến dịch chưa ghép được app nào. */
const UNMATCHED = '__unmatched__';

const usd = (v: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const cents = (v: number) => v.toFixed(2);

/** Doanh thu quảng cáo vs chi phí UA theo ngày, cho 1 app hoặc tất cả. */
export function MonetPage() {
  const { can } = useAuth();
  const [filters, setFilters] = useFilters();
  const q = qs(filterQuery(filters));
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

  const data = series.data ?? [];
  const cur = summary.data?.current;
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
        <DateRangePicker from={filters.from} to={filters.to} onChange={setFilters} />
        <button className="clear" onClick={() => setFilters({ countries: [], from: daysAgo(6), to: daysAgo(0) })}>Clear</button>
        <div className="spacer" />
        <UpdateButton />
      </div>

      <div className="monet-body">
        <section className="monet-main">
          <h3>General Statistics</h3>
          {series.isLoading ? <div className="chart-placeholder">Đang tải…</div> : <ProfitOverviewChart data={data} />}
          {cur && (
            <div className="monet-totals">
              <span>Revenue <b>{money(cur.earnings)}</b></span>
              <span>Spend <b>{money(cur.spend)}</b></span>
              <span>Profit <b className={cur.profit < 0 ? 'neg' : 'pos'}>{money(cur.profit)}</b></span>
              <span>ROAS <b>{cur.spend ? ratio(cur.roas) : '—'}</b></span>
            </div>
          )}
          {!selected && unmatched > 0 && cur && (
            <p className="small muted unmatched-note">
              Spend gồm <b>{money(unmatched)}</b> chưa ghép app nào ({money(cur.spend - unmatched)} của các app).
              {' '}
              <button className="link" onClick={() => setFilters({ appIds: [UNMATCHED] })}>Xem chi tiết</button>
            </p>
          )}
        </section>

        {cur && !series.isLoading && (
          <div className="monet-grid">
            <MiniChart title="Install" statLabel="Total" stat={cur.installs} data={data} field="installs" fmt={num} />
            <MiniChart title="Spend(USD)" statLabel="Total" stat={cur.spend} data={data} field="spend" fmt={usd} />
            <MiniChart title="CPI(USD)" statLabel="Avg" stat={cur.cpi} data={data} field="cpi" fmt={cents} axisFmt={cents} />
            <MiniChart title="ADS Revenue" statLabel="Total" stat={cur.earnings} data={data} field="earnings" fmt={usd} />
            <MiniChart title="ROAS" statLabel="Avg" stat={cur.roas} data={data} field="roas" fmt={ratio} axisFmt={cents} />
            <MiniChart title="Profit (USD)" statLabel="Total" stat={cur.profit} data={data} field="profit" fmt={usd} signed />
          </div>
        )}

        <section className="monet-table">
          <h3>Theo ngày</h3>
          <table>
            <thead>
              <tr>
                <th>Ngày</th>
                <th className="num">Revenue</th>
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
                  <td className="num">{money(d.earnings)}</td>
                  <td className="num">{money(d.spend)}</td>
                  <td className={`num ${d.profit < 0 ? 'neg' : ''}`}>{money(d.profit)}</td>
                  <td className="num">{d.spend ? ratio(d.roas) : '—'}</td>
                  <td className="num">{num(d.installs)}</td>
                  <td className="num">{d.installs ? money(d.cpi) : '—'}</td>
                  <td className="num">{money(d.ecpm)}</td>
                </tr>
              ))}
              {!data.length && <tr><td colSpan={8} className="center muted">Không có dữ liệu</td></tr>}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
