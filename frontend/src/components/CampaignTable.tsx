import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { api, patch, qs } from '../api';
import { useAuth } from '../auth';
import { daysAgo, money, num, ratio } from '../format';
import type { AppInfo, CampaignDay, FbCampaign } from '../types';
import { DateRangePicker } from './DateRangePicker';
import { SearchSelect } from './SearchSelect';

/**
 * Bảng "Chiến dịch → App" dùng chung cho Facebook và Google Ads: lọc theo ngày + package, chi phí USD kèm
 * tiền gốc. Admin chọn app bằng tay cho chiến dịch không ghép tự động được; người khác chỉ xem.
 * Với Google Ads (withRoas): thêm conversion value + ROAS do Google báo, bấm vào chiến dịch để xem theo ngày.
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
  const columns = 6 + Number(showLocal) + (withRoas ? 2 : 0);
  const total = rows.reduce(
    (s, r) => ({ usd: s.usd + r.totalSpend, local: s.local + r.localSpend, installs: s.installs + r.installs, conv: s.conv + r.convValue }),
    { usd: 0, local: 0, installs: 0, conv: 0 },
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
        {withRoas && ' Conv. value và ROAS là số Google Ads báo (giống cột trên Google Ads). Bấm vào chiến dịch để xem theo ngày.'}
      </p>
      <div className="filters">
        <DateRangePicker from={range.from} to={range.to} onChange={setRange} />
        <label>
          Package
          <SearchSelect value={storeIds} onChange={setStoreIds} allLabel="Tất cả" placeholder="Gõ package…" width={280}
            options={(packages.data ?? []).map((p) => ({ value: p, label: p }))} />
        </label>
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
              <th>App</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <Fragment key={c.id}>
                <tr className={withRoas ? 'clickable' : undefined}
                  onClick={withRoas ? () => setExpanded(expanded === c.id ? null : c.id) : undefined}>
                  <td className="label-cell" title={`${c.name}\n${c.id}`}>
                    {withRoas && <span className="muted">{expanded === c.id ? '▾ ' : '▸ '}</span>}
                    {c.name}
                  </td>
                  <td className="muted">{c.storeId ?? '—'}</td>
                  <td className="num">{money(c.totalSpend)}</td>
                  {showLocal && <td className="num muted">{localFmt(c.localSpend)}</td>}
                  <td className="num">{num(c.installs)}</td>
                  <td className="num">{c.installs ? money(c.totalSpend / c.installs) : '—'}</td>
                  {withRoas && <td className="num">{money(c.convValue)}</td>}
                  {withRoas && <td className="num">{c.totalSpend ? ratio(c.convValue / c.totalSpend) : '—'}</td>}
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
                {withRoas && expanded === c.id && (
                  <tr className="detail-row">
                    <td colSpan={columns}>
                      <CampaignDaily apiBase={apiBase} campaignId={c.id} range={range} showLocal={showLocal} localFmt={localFmt} />
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
function CampaignDaily({ apiBase, campaignId, range, showLocal, localFmt }: {
  apiBase: string;
  campaignId: string;
  range: { from: string; to: string };
  showLocal: boolean;
  localFmt: (v: number) => string;
}) {
  const daily = useQuery({
    queryKey: ['campaigns', apiBase, 'daily', campaignId, range.from, range.to],
    queryFn: () => api<CampaignDay[]>(`${apiBase}/campaigns/${campaignId}/daily?${qs(range)}`),
  });

  if (daily.isLoading) return <div className="muted small">Đang tải…</div>;
  if (daily.error) return <div className="error-text small">{daily.error.message}</div>;
  if (!daily.data?.length) return <div className="muted small">Không có số liệu trong khoảng ngày này.</div>;

  return (
    <table className="daily-table">
      <thead>
        <tr>
          <th>Ngày</th>
          <th className="num">Chi phí (USD)</th>
          {showLocal && <th className="num">Chi phí gốc</th>}
          <th className="num">Impressions</th>
          <th className="num">Clicks</th>
          <th className="num">Installs</th>
          <th className="num">CPI</th>
          <th className="num">Conv. value</th>
          <th className="num">ROAS</th>
        </tr>
      </thead>
      <tbody>
        {daily.data.map((d) => (
          <tr key={d.date}>
            <td>{d.date}</td>
            <td className="num">{money(d.spend)}</td>
            {showLocal && <td className="num muted">{localFmt(d.localSpend)}</td>}
            <td className="num">{num(d.impressions)}</td>
            <td className="num">{num(d.clicks)}</td>
            <td className="num">{num(d.installs)}</td>
            <td className="num">{d.cpi === null ? '—' : money(d.cpi)}</td>
            <td className="num">{money(d.convValue)}</td>
            <td className="num">{d.roas === null ? '—' : ratio(d.roas)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
