import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { compact, money, num } from '../format';
import type { TimePoint } from '../types';

export type ChartMetric = 'earnings' | 'ecpm' | 'impressions';

const LABELS: Record<ChartMetric, string> = {
  earnings: 'Doanh thu',
  ecpm: 'eCPM',
  impressions: 'Impressions',
};

export function RevenueChart({ data, metric }: { data: TimePoint[]; metric: ChartMetric }) {
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
          formatter={(v) => [fmt(Number(v)), LABELS[metric]]}
          contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}
        />
        <Area type="monotone" dataKey={metric} stroke="var(--accent)" strokeWidth={2} fill="url(#fill)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
