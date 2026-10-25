import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { money, relative } from '../format';
import type { GadsHourly } from '../types';

/** Số giờ gần nhất Google Ads thường chưa ghi nhận đủ conversion value (doanh thu từ Firebase/GA4 về trễ). */
const LATE_HOURS = 3;

/**
 * ROAS theo giờ hôm nay của từng chiến dịch Google Ads (conversion value Google ghi nhận / chi phí), lấy trực tiếp
 * từ Google Ads, tự tải lại mỗi 5 phút. Mặc định mỗi ô là ROAS riêng của giờ đó; bật "Lũy kế" để xem cộng dồn từ 0h.
 */
export function HourlyRoasTable() {
  const [cumulative, setCumulative] = useState(false);
  const data = useQuery({
    queryKey: ['google-ads', 'hourly-today'],
    queryFn: () => api<GadsHourly>('/google-ads/hourly-today'),
    refetchInterval: 5 * 60_000,
  });
  const d = data.data;
  const campaigns = [...(d?.campaigns ?? [])]
    .map((c) => ({ ...c, spend: c.hours.reduce((s, h) => s + h.spend, 0), value: c.hours.reduce((s, h) => s + h.value, 0) }))
    .sort((a, b) => b.spend - a.spend);
  const hours = d ? Array.from({ length: d.currentHour + 1 }, (_, i) => i) : [];
  const late = (h: number) => !!d && h > d.currentHour - LATE_HOURS;

  /** Chi phí và value của 1 chiến dịch (hoặc tất cả) tại giờ h: riêng giờ đó, hoặc lũy kế 0h…h. */
  const at = (list: typeof campaigns, h: number) => {
    let spend = 0;
    let value = 0;
    for (const c of list) {
      for (const x of c.hours) {
        if (cumulative ? x.hour <= h : x.hour === h) {
          spend += x.spend;
          value += x.value;
        }
      }
    }
    return { spend, value };
  };
  const cell = (list: typeof campaigns, h: number, key: string | number) => {
    const { spend, value } = at(list, h);
    if (!spend) return <td key={key} className="num muted">—</td>;
    const roas = value / spend;
    return (
      <td key={key} className={`num ${roas >= 1 ? 'pos' : 'neg'} ${late(h) ? 'roas-partial' : ''}`}
        title={`Chi phí ${money(spend)} · Value ${money(value)}${late(h) ? ' · Giờ gần đây: value còn về trễ' : ''}`}>
        {roas.toFixed(2)}
      </td>
    );
  };
  const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0);
  const totalValue = campaigns.reduce((s, c) => s + c.value, 0);

  return (
    <>
      <h2>ROAS theo giờ hôm nay{d ? ` (${d.date})` : ''}</h2>
      <div className="filters">
        <label className="inline">
          <input type="checkbox" checked={cumulative} onChange={(e) => setCumulative(e.target.checked)} /> Lũy kế từ 0h
        </label>
        <span className="small muted">
          {cumulative ? 'Mỗi ô: ROAS cộng dồn từ 0h tới giờ đó.' : 'Mỗi ô: ROAS riêng của giờ đó (value ÷ chi phí trong giờ).'}{' '}
          Lấy trực tiếp từ Google Ads, tự tải lại 5 phút/lần · cập nhật {relative(d?.fetchedAt ?? null)}. {LATE_HOURS} giờ gần
          nhất (in nghiêng) Google còn ghi nhận value trễ nên ROAS thấp hơn thực tế.
        </span>
      </div>
      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Chiến dịch</th>
              <th className="num">Chi phí</th>
              <th className="num">Value</th>
              <th className="num">ROAS</th>
              {hours.map((h) => <th key={h} className="num">{h}h</th>)}
            </tr>
          </thead>
          <tbody>
            {campaigns.length > 1 && (
              <tr className="total-row">
                <td><b>Tổng</b></td>
                <td className="num"><b>{money(totalSpend)}</b></td>
                <td className="num"><b>{money(totalValue)}</b></td>
                <td className="num"><b>{totalSpend ? (totalValue / totalSpend).toFixed(2) : '—'}</b></td>
                {hours.map((h) => cell(campaigns, h, h))}
              </tr>
            )}
            {campaigns.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td className="num">{money(c.spend)}</td>
                <td className="num">{money(c.value)}</td>
                <td className="num">{c.spend ? (c.value / c.spend).toFixed(2) : '—'}</td>
                {hours.map((h) => cell([c], h, h))}
              </tr>
            ))}
            {data.isLoading && <tr><td colSpan={4} className="center muted">Đang tải…</td></tr>}
            {data.isError && <tr><td colSpan={4} className="center error-text">{(data.error as Error).message}</td></tr>}
            {d && !campaigns.length && <tr><td colSpan={4} className="center muted">Hôm nay chưa có chiến dịch nào chạy.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
