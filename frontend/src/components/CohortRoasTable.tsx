import { useQuery } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { api, qs } from '../api';
import { daysAgo, money, num } from '../format';
import type { CohortRoasCampaign, CohortRoasRow, FbCampaign } from '../types';
import { DateRangePicker } from './DateRangePicker';
import { DayPicker } from './DayPicker';
import { SearchSelect } from './SearchSelect';

/** Mốc mặc định; người dùng chọn thêm / bớt bằng ô "Mốc ROAS" (tới D44, giới hạn dữ liệu GA4). */
const DEFAULT_DAYS = [0, 1, 3, 7, 14, 30];
const EXTRA_DAYS = [35, 40, 44];
const MAX_DAY = 44;

type Status = 'partial' | 'final';
/** Nguồn doanh thu cho cột ROAS: Google Ads (conversion value, cửa sổ 7 ngày) hoặc GA4 (doanh thu thật, không giới hạn). */
type Source = 'gads' | 'ga4';

/** Trạng thái GA4: mốc DN chỉ đủ khi ngày cài + N < hôm nay - 1 (GA4 xử lý trễ khoảng 1 ngày). */
function gaStatus(date: string, n: number): Status {
  const age = Math.round((Date.parse(daysAgo(0)) - Date.parse(date)) / 86_400_000);
  return age > n + 1 ? 'final' : 'partial';
}

/**
 * Ô ROAS: xanh khi hoà vốn trở lên (≥ 1x), đỏ khi dưới. Số in nghiêng khi chưa đủ ngày (tích luỹ tới hiện
 * tại, còn tăng), số thường khi đã chốt. "—" khi không có chi phí.
 */
function RoasCell({ v, status }: { v: number | null; status: Status }) {
  if (v === null) return <td className="num muted">—</td>;
  const tone = v >= 1 ? 'pos' : 'neg';
  if (status === 'partial') {
    return <td className={`num ${tone} roas-partial`} title="Chưa chốt: số còn tăng tới khi đủ ngày">{v.toFixed(2)}</td>;
  }
  return <td className={`num ${tone}`} title="Đã chốt">{v.toFixed(2)}</td>;
}

/**
 * ROAS kiểu cohort (giống Adjust) cho Google Ads: mỗi dòng là 1 ngày chạy quảng cáo, ROAS DN = conversion value
 * Google ghi nhận trong N ngày kể từ lúc tương tác / chi phí ngày đó.
 */
export function CohortRoasTable() {
  const [range, setRange] = useState({ from: daysAgo(44), to: daysAgo(0) });
  const [campaignIds, setCampaignIds] = useState<string[]>([]);
  const [storeIds, setStoreIds] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  // Mặc định GA4 (doanh thu thật, không giới hạn 7 ngày); nhớ lựa chọn.
  const [source, setSource] = useState<Source>(() => (localStorage.getItem('roas-source-v2') as Source) || 'ga4');
  const pickSource = (v: Source) => {
    setSource(v);
    localStorage.setItem('roas-source-v2', v);
  };
  const [dayNums, setDayNums] = useState<number[]>(() => {
    const saved = localStorage.getItem('roas-days')?.split(',').map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= MAX_DAY);
    return saved?.length ? saved : DEFAULT_DAYS;
  });
  const pickDays = (v: number[]) => {
    const next = v.length ? v : DEFAULT_DAYS;
    setDayNums(next);
    localStorage.setItem('roas-days', next.join(','));
  };
  const DAYS = dayNums.map((n) => `d${n}`);

  const campaigns = useQuery({
    queryKey: ['campaigns', '/google-ads', 'all'],
    queryFn: () => api<FbCampaign[]>('/google-ads/campaigns'),
  });
  const packages = [...new Set((campaigns.data ?? []).map((c) => c.storeId).filter((s): s is string => !!s))].sort();
  const q = qs({ ...range, campaignIds, storeIds, days: dayNums.join(',') });
  const data = useQuery({
    queryKey: ['google-ads', 'roas-cohort', q],
    queryFn: () => api<CohortRoasRow[]>(`/google-ads/roas-cohort?${q}`),
  });
  const rows = data.data ?? [];

  // Dòng tổng: mọi mốc chia cho cùng tổng chi phí nên luôn D0 ≤ D3 ≤ …; chưa chốt nếu còn ngày nào chưa đủ mốc.
  const spend = rows.reduce((s, r) => s + r.spend, 0);
  const total = Object.fromEntries(DAYS.map((d) => {
    if (source === 'ga4') {
      // ROAS GA4 tổng = tổng doanh thu DN (roas x spend từng ngày) / tổng chi phí.
      const value = rows.reduce((s, r) => s + (r.gaRoas[d] ?? 0) * r.spend, 0);
      const n = Number(d.slice(1));
      const status: Status = rows.every((r) => gaStatus(r.date, n) === 'final') ? 'final' : 'partial';
      return [d, { v: spend ? value / spend : null, status }];
    }
    const value = rows.reduce((s, r) => s + r.value[d], 0);
    const status: Status = rows.every((r) => r.status[d] === 'final') ? 'final' : 'partial';
    return [d, { v: spend ? value / spend : null, status }];
  })) as Record<string, { v: number | null; status: Status }>;
  const gaRevenue = rows.reduce((s, r) => s + r.gaRevenue, 0);
  const installs = rows.reduce((s, r) => s + r.installs, 0);
  const convValue = rows.reduce((s, r) => s + r.convValue, 0);

  return (
    <>
      <h2>ROAS theo ngày</h2>
      <div className="roas-source">
        <div className="seg seg-lg">
          <button className={source === 'ga4' ? 'active' : ''} onClick={() => pickSource('ga4')}>
            ROAS GA4 <small>doanh thu thật</small>
          </button>
          <button className={source === 'gads' ? 'active' : ''} onClick={() => pickSource('gads')}>
            ROAS Google Ads <small>cửa sổ 7 ngày</small>
          </button>
        </div>
        <span className="small muted">
          {source === 'ga4'
            ? 'Doanh thu quảng cáo (GA4) của người dùng đến từ chiến dịch, cài ngày đó, chia chi phí ngày đó. Không giới hạn số ngày.'
            : 'Conversion value Google Ads ghi nhận (cửa sổ 7 ngày sau click): số Google dùng để đấu giá, ngừng tăng sau khoảng D7.'}
        </span>
      </div>
      <div className="filters">
        <DayPicker value={dayNums} max={MAX_DAY} defaults={DEFAULT_DAYS} extra={EXTRA_DAYS} label="Mốc ROAS" align="left" onChange={pickDays} />
        <DateRangePicker from={range.from} to={range.to} onChange={setRange} />
        <label>
          Package
          <SearchSelect value={storeIds} onChange={setStoreIds} allLabel="Tất cả" placeholder="Gõ package…" width={240}
            options={packages.map((p) => ({ value: p, label: p }))} />
        </label>
        <label>
          Chiến dịch
          <SearchSelect value={campaignIds} onChange={setCampaignIds} allLabel="Tất cả" placeholder="Gõ tên chiến dịch…" width={280}
            options={(campaigns.data ?? [])
              .filter((c) => !storeIds.length || (c.storeId && storeIds.includes(c.storeId)))
              .map((c) => ({ value: c.id, label: c.name, keywords: c.storeId ?? '' }))} />
        </label>
      </div>
      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Ngày</th>
              <th className="num">Chi phí</th>
              <th className="num">Installs</th>
              <th className="num">CPI</th>
              {DAYS.map((d) => <th key={d} className="num">ROAS {d.toUpperCase()}{source === 'ga4' ? ' (GA4)' : ''}</th>)}
              {source === 'ga4'
                ? <th className="num" title="Doanh thu quảng cáo GA4 tới hiện tại của người dùng từ các chiến dịch, cài ngày đó">Rev GA4</th>
                : <th className="num" title="Conversion value ghi nhận tới hiện tại (mọi độ trễ)">Conv. value</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 && (
              <tr className="total-row">
                <td><b>Tổng ({rows.length} ngày)</b></td>
                <td className="num"><b>{money(spend)}</b></td>
                <td className="num"><b>{num(installs)}</b></td>
                <td className="num"><b>{installs ? money(spend / installs) : '—'}</b></td>
                {DAYS.map((d) => <RoasCell key={d} v={total[d].v} status={total[d].status} />)}
                <td className="num"><b>{money(source === 'ga4' ? gaRevenue : convValue)}</b></td>
              </tr>
            )}
            {rows.map((r) => (
              <Fragment key={r.date}>
                <tr className="clickable" onClick={() => setExpanded(expanded === r.date ? null : r.date)}>
                  <td><span className="muted">{expanded === r.date ? '▾ ' : '▸ '}</span>{r.date}</td>
                  <td className="num">{money(r.spend)}</td>
                  <td className="num">{num(r.installs)}</td>
                  <td className="num">{r.installs ? money(r.spend / r.installs) : '—'}</td>
                  {DAYS.map((d) => (source === 'ga4'
                    ? <RoasCell key={d} v={r.gaRoas[d]} status={gaStatus(r.date, Number(d.slice(1)))} />
                    : <RoasCell key={d} v={r.roas[d]} status={r.status[d]} />))}
                  <td className="num" title={source === 'ga4' ? `${num(r.gaUsers)} người dùng mới (GA4)` : undefined}>
                    {money(source === 'ga4' ? r.gaRevenue : r.convValue)}
                  </td>
                </tr>
                {expanded === r.date && (
                  <tr className="detail-row">
                    <td colSpan={4 + DAYS.length + 1}>
                      <DayCampaigns date={r.date} campaignIds={campaignIds} storeIds={storeIds} source={source} days={dayNums} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {!data.isLoading && rows.length === 0 && (
              <tr><td colSpan={4 + DAYS.length + 1} className="center muted">Không có số liệu trong khoảng ngày này.</td></tr>
            )}
            {data.isLoading && <tr><td colSpan={4 + DAYS.length + 1} className="center muted">Đang tải…</td></tr>}
          </tbody>
        </table>
      </div>
      {!data.isLoading && rows.length > 0 && convValue === 0 && (
        <p className="small error-text">
          Google Ads chưa ghi nhận conversion value nào. Kiểm tra app đã gửi doanh thu (Firebase ad_impression /
          in_app_purchase) và đã nhập vào Google Ads dưới dạng chuyển đổi có giá trị chưa.
        </p>
      )}
    </>
  );
}

/** Các chiến dịch chạy trong 1 ngày: budget/ngày, chi phí, installs, CPI, conv. value, ROAS D0…D30 của ngày đó. */
function DayCampaigns({ date, campaignIds, storeIds, source, days }: {
  date: string;
  campaignIds: string[];
  storeIds: string[];
  source: Source;
  days: number[];
}) {
  const DAYS = days.map((n) => `d${n}`);
  const q = qs({ date, campaignIds, storeIds, days: days.join(',') });
  const data = useQuery({
    queryKey: ['google-ads', 'roas-cohort', 'campaigns', q],
    queryFn: () => api<CohortRoasCampaign[]>(`/google-ads/roas-cohort/campaigns?${q}`),
  });

  if (data.isLoading) return <div className="muted small">Đang tải…</div>;
  if (data.error) return <div className="error-text small">{data.error.message}</div>;
  if (!data.data?.length) return <div className="muted small">Không có chiến dịch nào chạy trong ngày {date}.</div>;

  return (
    <table className="daily-table">
      <thead>
        <tr>
          <th>Chiến dịch ({date})</th>
          <th className="num" title="Budget/ngày của chiến dịch (mức cuối ngày)">Budget/ngày</th>
          <th className="num">Chi phí</th>
          <th className="num">Installs</th>
          <th className="num">CPI</th>
          {DAYS.map((d) => <th key={d} className="num">ROAS {d.toUpperCase()}{source === 'ga4' ? ' (GA4)' : ''}</th>)}
          {source === 'ga4'
            ? <th className="num" title="Doanh thu quảng cáo GA4 tới hiện tại của người dùng từ chiến dịch">Rev GA4</th>
            : <th className="num" title="Conversion value ghi nhận tới hiện tại (mọi độ trễ)">Conv. value</th>}
        </tr>
      </thead>
      <tbody>
        {data.data.map((c) => (
          <tr key={c.id}>
            <td className="label-cell" title={`${c.name}\n${c.id}${c.storeId ? `\n${c.storeId}` : ''}`}>{c.name}</td>
            <td className="num" title={c.budget === null ? 'Chưa ghi nhận được budget của ngày này' : undefined}>
              {c.budget === null ? '—' : money(c.budget)}
            </td>
            <td className="num">{money(c.spend)}</td>
            <td className="num">{num(c.installs)}</td>
            <td className="num">{c.cpi === null ? '—' : money(c.cpi)}</td>
            {DAYS.map((d) => (source === 'ga4'
              ? <RoasCell key={d} v={c.gaRoas[d]} status={gaStatus(date, Number(d.slice(1)))} />
              : <RoasCell key={d} v={c.roas[d]} status={c.status[d]} />))}
            <td className="num" title={source === 'ga4' ? `${num(c.gaUsers)} người dùng mới (GA4)` : undefined}>
              {money(source === 'ga4' ? c.gaRevenue : c.convValue)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
