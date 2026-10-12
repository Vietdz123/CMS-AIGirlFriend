import { Area, AreaChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { compact, money, num } from '../format';
import type { TimePoint } from '../types';

export type ChartMetric = 'earnings' | 'profit' | 'ecpm' | 'impressions';

const LABELS: Record<ChartMetric, string> = {
  earnings: 'Doanh thu',
  profit: 'Lợi nhuận',
  ecpm: 'eCPM',
  impressions: 'Impressions',
};

export function RevenueChart({ data, metric, showSpend }: { data: TimePoint[]; metric: ChartMetric; showSpend?: boolean }) {
  const withSpend = showSpend && metric === 'earnings';
  const fmt = metric === 'impressions' ? num : money;
  const axisFmt = metric === 'impressions' ? compact : (v: number) => `$${compact(v)}`;
  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 12 }}
          tickFormatter={(d: string) => d.slice(5)} minTickGap={24} />
        <YAxis tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 12 }}
          tickFormatter={axisFmt} width={56} />
        <Tooltip
          formatter={(v, key) => [fmt(Number(v)), key === 'spend' ? 'Chi phí' : LABELS[metric]]}
          contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}
        />
        {metric === 'profit' && <ReferenceLine y={0} stroke="var(--muted)" />}
        <Area type="monotone" dataKey={metric} name={LABELS[metric]} stroke="var(--accent)" strokeWidth={2} fill="url(#fill)" />
        {withSpend && (
          <Area type="monotone" dataKey="spend" name="Chi phí" stroke="var(--down)" strokeWidth={2} fill="none" />
        )}
        {withSpend && <Legend verticalAlign="top" height={28} iconType="plainline" />}
      </AreaChart>
    </ResponsiveContainer>
  );
}
