import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, patch, qs } from '../api';
import { useAuth } from '../auth';
import { daysAgo, money, num } from '../format';
import type { AppInfo, FbCampaign } from '../types';
import { DateRangePicker } from './DateRangePicker';
import { SearchSelect } from './SearchSelect';

/**
 * Bảng "Chiến dịch → App" dùng chung cho Facebook và Google Ads: lọc theo ngày + package, chi phí USD kèm
 * tiền gốc. Admin chọn app bằng tay cho chiến dịch không ghép tự động được; người khác chỉ xem.
 */
export function CampaignTable({ apiBase, currency }: {
  /** '/facebook' | '/google-ads' */
  apiBase: string;
  /** Tiền tệ gốc khi mọi tài khoản cùng 1 loại tiền, để hiện cột chi phí gốc. */
  currency?: string;
}) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [range, setRange] = useState({ from: daysAgo(29), to: daysAgo(0) });
  const [storeIds, setStoreIds] = useState<string[]>([]);
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
  const total = rows.reduce((s, r) => ({ usd: s.usd + r.totalSpend, local: s.local + r.localSpend, installs: s.installs + r.installs }),
    { usd: 0, local: 0, installs: 0 });
  const localFmt = (v: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: currency ?? 'USD', maximumFractionDigits: 0 }).format(v);

  return (
    <>
      <h2>Chiến dịch → App</h2>
      <p className="small muted">
        Chiến dịch quảng bá app được ghép tự động theo package name.
        {can('ADMIN') && ' Chiến dịch không ghép được thì chọn app bằng tay, nếu không chi phí sẽ nằm ở dòng "Chưa ghép app".'}
        {' '}Chi phí đã quy đổi sang USD theo tỷ giá từng ngày.
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
              <th>App</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td className="label-cell" title={`${c.name}\n${c.id}`}>{c.name}</td>
                <td className="muted">{c.storeId ?? '—'}</td>
                <td className="num">{money(c.totalSpend)}</td>
                {showLocal && <td className="num muted">{localFmt(c.localSpend)}</td>}
                <td className="num">{num(c.installs)}</td>
                <td className="num">{c.installs ? money(c.totalSpend / c.installs) : '—'}</td>
                <td>
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
            ))}
            {rows.length > 0 && (
              <tr className="total-row">
                <td colSpan={2}><b>Tổng ({rows.length} chiến dịch)</b></td>
                <td className="num"><b>{money(total.usd)}</b></td>
                {showLocal && <td className="num muted"><b>{localFmt(total.local)}</b></td>}
                <td className="num"><b>{num(total.installs)}</b></td>
                <td className="num"><b>{total.installs ? money(total.usd / total.installs) : '—'}</b></td>
                <td />
              </tr>
            )}
            {!campaigns.isLoading && rows.length === 0 && (
              <tr><td colSpan={showLocal ? 7 : 6} className="center muted">Không có chiến dịch nào khớp bộ lọc.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
