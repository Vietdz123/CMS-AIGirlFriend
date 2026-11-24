import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { api, patch, qs } from '../api';
import { useAuth } from '../auth';
import { daysAgo, money, num, ratio } from '../format';

/** Mốc ROAS cohort trong bảng theo ngày của chiến dịch (D30 = cộng dồn tới D30). */
const ROAS_DAYS = [0, 3, 7, 14, 30];
import type { AppInfo, CampaignDay, CohortRoasRow, FbCampaign } from '../types';
import { gaStatus, RoasCell, type Source } from './CohortRoasTable';
import { DateRangePicker } from './DateRangePicker';
import { SearchSelect } from './SearchSelect';

/**
 * Bảng "Chiến dịch → App" dùng chung cho Facebook và Google Ads: lọc theo ngày + package, chi phí USD kèm
 * tiền gốc. Admin chọn app bằng tay cho chiến dịch không ghép tự động được; người khác chỉ xem.
 * Bấm vào chiến dịch để xem theo ngày (có budget/ngày). Google Ads (withRoas): thêm conversion value + ROAS do Google báo.
 */
export function CampaignTable({ apiBase, currency, withRoas }: {
  /** '/facebook' | '/google-ads' */
  apiBase: string;
  /** Tiền tệ gốc khi mọi tài khoản cùng 1 loại tiền, để hiện cột chi phí gốc. */
  currency?: string;
  withRoas?: boolean;
}) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [range, setRange] = useState({ from: daysAgo(29), to: daysAgo(0) });
  const [storeIds, setStoreIds] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  // So sánh với GA4: thêm cột Rev GA4 + ROAS GA4, và hàng GA4 / Google Ads dưới mỗi ngày khi xổ chiến dịch. Nhớ lựa chọn.
  const [compare, setCompare] = useState(() => localStorage.getItem('campaign-compare-ga4') === '1');
  const pickCompare = (v: boolean) => {
    setCompare(v);
    localStorage.setItem('campaign-compare-ga4', v ? '1' : '0');
  };
  const showGa = !!withRoas && compare;
  const q = qs({ ...range, storeIds });

  const campaigns = useQuery({
    queryKey: ['campaigns', apiBase, q],
    queryFn: () => api<FbCampaign[]>(`${apiBase}/campaigns?${q}`),
  });
  const packages = useQuery({ queryKey: ['campaign-packages', apiBase], queryFn: () => api<string[]>(`${apiBase}/packages`) });
  const apps = useQuery({ queryKey: ['apps'], queryFn: () => api<AppInfo[]>('/admob/apps') });
  const appName = (id: string | null) => (id ? apps.data?.find((a) => a.id === id)?.name ?? id : null);
  const setApp = useMutation({
    mutationFn: ({ id, appId }: { id: string; appId: string }) => patch(`${apiBase}/campaigns/${id}`, { appId }),
    onSuccess: () => queryClient.invalidateQueries(),
  });

  const rows = campaigns.data ?? [];
  const showLocal = !!currency && currency !== 'USD';
  const columns = 6 + Number(showLocal) + (withRoas ? 2 : 0) + (showGa ? 2 : 0);
  const total = rows.reduce(
    (s, r) => ({
      usd: s.usd + r.totalSpend, local: s.local + r.localSpend, installs: s.installs + r.installs, conv: s.conv + r.convValue,
      ga: s.ga + (r.gaRevenue ?? 0),
    }),
    { usd: 0, local: 0, installs: 0, conv: 0, ga: 0 },
  );
  const localFmt = (v: number) =>
    new Intl.NumberFormat('vi-VN', { style: 'currency', currency: currency ?? 'USD', maximumFractionDigits: 0 }).format(v);

  return (
    <>
      <h2>Chiến dịch → App</h2>
      <p className="small muted">
        Chiến dịch quảng bá app được ghép tự động theo package name.
        {can('ADMIN') && ' Chiến dịch không ghép được thì chọn app bằng tay, nếu không chi phí sẽ nằm ở dòng "Chưa ghép app".'}
        {' '}Chi phí đã quy đổi sang USD theo tỷ giá từng ngày.
        {withRoas && ' Conv. value và ROAS là số Google Ads báo (giống cột trên Google Ads).'}
        {' '}Bấm vào chiến dịch để xem theo ngày.
      </p>
      <div className="filters">
        <DateRangePicker from={range.from} to={range.to} onChange={setRange} />
        <label>
          Package
          <SearchSelect value={storeIds} onChange={setStoreIds} allLabel="Tất cả" placeholder="Gõ package…" width={280}
            options={(packages.data ?? []).map((p) => ({ value: p, label: p }))} />
        </label>
        {withRoas && (
          <label className="inline" title="Thêm cột doanh thu và ROAS theo GA4 (doanh thu thật, không giới hạn 7 ngày) cạnh số Google Ads">
            <input type="checkbox" checked={compare} onChange={(e) => pickCompare(e.target.checked)} /> So sánh GA4
          </label>
        )}
      </div>
      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Chiến dịch</th>
              <th>Package</th>
              <th className="num">Chi phí (USD)</th>
              {showLocal && <th className="num">Chi phí ({currency})</th>}
              <th className="num">Installs</th>
              <th className="num">CPI</th>
              {withRoas && <th className="num">Conv. value</th>}
              {withRoas && <th className="num">ROAS</th>}
              {showGa && <th className="num" title="Doanh thu QC GA4 tới hiện tại của người dùng từ chiến dịch, cài trong khoảng ngày">Rev GA4</th>}
              {showGa && <th className="num">ROAS GA4</th>}
              <th>App</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <Fragment key={c.id}>
                <tr className="clickable" onClick={() => setExpanded(expanded === c.id ? null : c.id)}>
                  <td className="label-cell" title={`${c.name}\n${c.id}`}>
                    <span className="muted">{expanded === c.id ? '▾ ' : '▸ '}</span>
                    {c.name}
                  </td>
                  <td className="muted">{c.storeId ?? '—'}</td>
                  <td className="num">{money(c.totalSpend)}</td>
                  {showLocal && <td className="num muted">{localFmt(c.localSpend)}</td>}
                  <td className="num">{num(c.installs)}</td>
                  <td className="num">{c.installs ? money(c.totalSpend / c.installs) : '—'}</td>
                  {withRoas && <td className="num">{money(c.convValue)}</td>}
                  {withRoas && <td className="num">{c.totalSpend ? ratio(c.convValue / c.totalSpend) : '—'}</td>}
                  {showGa && <td className="num">{money(c.gaRevenue ?? 0)}</td>}
                  {showGa && <RoasValue v={c.totalSpend ? (c.gaRevenue ?? 0) / c.totalSpend : null} />}
                  {/* Chọn app không được mở/đóng bảng theo ngày. */}
                  <td onClick={(e) => e.stopPropagation()}>
                    {can('ADMIN') ? (
                      <select value={c.appId ?? ''} onChange={(e) => setApp.mutate({ id: c.id, appId: e.target.value })}>
                        <option value="">{c.autoAppId ? `Tự động: ${appName(c.autoAppId)}` : 'Chưa ghép app'}</option>
                        {apps.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                    ) : (
                      appName(c.appId ?? c.autoAppId) ?? <span className="muted">Chưa ghép app</span>
                    )}
                  </td>
                </tr>
                {expanded === c.id && (
                  <tr className="detail-row">
                    <td colSpan={columns}>
                      <CampaignDaily apiBase={apiBase} campaignId={c.id} range={range} showLocal={showLocal} localFmt={localFmt}
                        withRoas={withRoas} compare={showGa} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {rows.length > 0 && (
              <tr className="total-row">
                <td colSpan={2}><b>Tổng ({rows.length} chiến dịch)</b></td>
                <td className="num"><b>{money(total.usd)}</b></td>
                {showLocal && <td className="num muted"><b>{localFmt(total.local)}</b></td>}
                <td className="num"><b>{num(total.installs)}</b></td>
                <td className="num"><b>{total.installs ? money(total.usd / total.installs) : '—'}</b></td>
                {withRoas && <td className="num"><b>{money(total.conv)}</b></td>}
                {withRoas && <td className="num"><b>{total.usd ? ratio(total.conv / total.usd) : '—'}</b></td>}
                {showGa && <td className="num"><b>{money(total.ga)}</b></td>}
                {showGa && <RoasValue v={total.usd ? total.ga / total.usd : null} bold />}
                <td />
              </tr>
            )}
            {!campaigns.isLoading && rows.length === 0 && (
              <tr><td colSpan={columns} className="center muted">Không có chiến dịch nào khớp bộ lọc.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Bảng từng ngày của 1 chiến dịch, trong cùng khoảng ngày đang lọc. */
/** Ô ROAS tô xanh khi ≥ 1 (hoà vốn), đỏ khi dưới. */
function RoasValue({ v, bold }: { v: number | null; bold?: boolean }) {
  if (v === null) return <td className="num muted">—</td>;
  const text = ratio(v);
  return <td className={`num ${v >= 1 ? 'pos' : 'neg'}`}>{bold ? <b>{text}</b> : text}</td>;
}

function CampaignDaily({ apiBase, campaignId, range, showLocal, localFmt, withRoas, compare }: {
  apiBase: string;
  campaignId: string;
  range: { from: string; to: string };
  showLocal: boolean;
  localFmt: (v: number) => string;
  withRoas?: boolean;
  /** Hiện hàng so sánh nguồn còn lại (GA4 / Google Ads) dưới mỗi ngày. */
  compare?: boolean;
}) {
  const daily = useQuery({
    queryKey: ['campaigns', apiBase, 'daily', campaignId, range.from, range.to],
    queryFn: () => api<CampaignDay[]>(`${apiBase}/campaigns/${campaignId}/daily?${qs(range)}`),
  });
  // ROAS D0/D3/D7/D14/D30 của chiến dịch theo ngày chạy: cùng nguồn (GA4 / Google Ads) đang chọn ở bảng "ROAS theo ngày".
  const source: Source = (localStorage.getItem('roas-source-v2') as Source) || 'ga4';
  const cohort = useQuery({
    queryKey: ['google-ads', 'roas-cohort', 'campaign', campaignId, range.from, range.to],
    queryFn: () => api<CohortRoasRow[]>(`/google-ads/roas-cohort?${qs({ ...range, campaignIds: [campaignId], days: ROAS_DAYS.join(',') })}`),
    enabled: !!withRoas,
  });
  const byDate = new Map((cohort.data ?? []).map((r) => [r.date, r]));
  // Số cột của bảng theo ngày (để hàng phụ căn đúng cột ROAS).
  const dailyCols = 7 + (showLocal ? 2 : 0) + (withRoas ? 2 + ROAS_DAYS.length : 0);

  if (daily.isLoading) return <div className="muted small">Đang tải…</div>;
  if (daily.error) return <div className="error-text small">{daily.error.message}</div>;
  if (!daily.data?.length) return <div className="muted small">Không có số liệu trong khoảng ngày này.</div>;

  return (
    <table className="daily-table">
      <thead>
        <tr>
          <th>Ngày</th>
          <th className="num" title="Budget/ngày của chiến dịch (mức cuối ngày)">Budget/ngày</th>
          {showLocal && <th className="num">Budget gốc</th>}
          <th className="num">Chi phí (USD)</th>
          {showLocal && <th className="num">Chi phí gốc</th>}
          <th className="num">Impressions</th>
          <th className="num">Clicks</th>
          <th className="num">Installs</th>
          <th className="num">CPI</th>
          {withRoas && <th className="num">Conv. value</th>}
          {withRoas && <th className="num">ROAS</th>}
          {withRoas && ROAS_DAYS.map((n) => (
            <th key={n} className="num" title={source === 'ga4'
              ? `Doanh thu GA4 của người dùng cài trong ngày, tới D${n} / chi phí ngày đó`
              : `Conversion value Google Ads trong ${n} ngày sau tương tác / chi phí ngày đó (cửa sổ 7 ngày)`}>
              D{n}{source === 'ga4' ? ' (GA4)' : ''}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {daily.data.map((d) => (
          <Fragment key={d.date}>
          <tr>
            <td>{d.date}</td>
            <td className="num" title={d.budget === null ? 'Chưa ghi nhận được budget của ngày này' : undefined}>
              {d.budget === null ? '—' : money(d.budget)}
            </td>
            {showLocal && <td className="num muted">{d.localBudget === null ? '—' : localFmt(d.localBudget)}</td>}
            <td className="num">{money(d.spend)}</td>
            {showLocal && <td className="num muted">{localFmt(d.localSpend)}</td>}
            <td className="num">{num(d.impressions)}</td>
            <td className="num">{num(d.clicks)}</td>
            <td className="num">{num(d.installs)}</td>
            <td className="num">{d.cpi === null ? '—' : money(d.cpi)}</td>
            {withRoas && <td className="num">{money(d.convValue)}</td>}
            {withRoas && <td className="num">{d.roas === null ? '—' : ratio(d.roas)}</td>}
            {withRoas && ROAS_DAYS.map((n) => {
              const r = byDate.get(d.date);
              if (!r) return <td key={n} className="num muted">{cohort.isLoading ? '…' : '—'}</td>;
              return source === 'ga4'
                ? <RoasCell key={n} v={r.gaRoas[`d${n}`] ?? null} status={gaStatus(d.date, n)} />
                : <RoasCell key={n} v={r.roas[`d${n}`] ?? null} status={r.status[`d${n}`]} />;
            })}
          </tr>
          {/* Hàng phụ: cùng ngày, theo nguồn còn lại (đang xem GA4 thì hiện Google Ads và ngược lại) để so sánh. */}
          {withRoas && compare && byDate.has(d.date) && (() => {
            const r = byDate.get(d.date)!;
            const other: Source = source === 'ga4' ? 'gads' : 'ga4';
            return (
              <tr className="sub-row">
                <td className="small muted">↳ {other === 'ga4' ? 'GA4' : 'Google Ads'}</td>
                <td colSpan={dailyCols - 2 - ROAS_DAYS.length} />
                <td className="num small muted" title={other === 'ga4' ? 'Doanh thu GA4 tới hiện tại / chi phí ngày đó' : 'Conversion value Google Ads / chi phí ngày đó'}>
                  {other === 'ga4' ? (r.spend ? ratio(r.gaRevenue / r.spend) : '—') : (r.spend ? ratio(r.convValue / r.spend) : '—')}
                </td>
                {ROAS_DAYS.map((n) => (other === 'ga4'
                  ? <RoasCell key={n} v={r.gaRoas[`d${n}`] ?? null} status={gaStatus(d.date, n)} />
                  : <RoasCell key={n} v={r.roas[`d${n}`] ?? null} status={r.status[`d${n}`]} />))}
              </tr>
            );
          })()}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}
