import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { compact, money } from '../format';
import type { TimePoint } from '../types';

/** Màu theo kiểu dashboard Monet & UA: doanh thu xanh lơ, chi phí vàng cam, lợi nhuận xanh đậm, chart nhỏ xanh thép. */
export const COLORS = { revenue: '#00a5d6', spend: '#eda100', profit: '#2c4a6b', line: '#3c78b5', zero: '#e02424', gain: '#16a34a' };

const axisTick = { fill: '#555', fontSize: 11 };
const gridStroke = '#ececec';
const tooltipStyle = { background: '#fff', border: '1px solid #ddd', borderRadius: 4, fontSize: 12 };
const usdAxis = (v: number) => `${v < 0 ? '-' : ''}${compact(Math.abs(v))}`;

/** Nhãn trục X: chỉ ngày (01, 02…) khi cả khoảng nằm trong 1 tháng, ngược lại MM-DD. */
function dayFormatter(data: { date: string }[]) {
  const sameMonth = data.length > 0 && data.every((d) => d.date.slice(0, 7) === data[0].date.slice(0, 7));
  return (d: string) => (sameMonth ? d.slice(8) : d.slice(5));
}

/**
 * "General Statistics": doanh thu là cột dương, chi phí là cột âm cùng ngày, lợi nhuận là đường.
 * Cả 3 cùng đơn vị USD nên dùng chung 1 trục — trục phụ riêng cho lợi nhuận sẽ phóng đại dao động của nó.
 */
export function ProfitOverviewChart({ data }: { data: TimePoint[] }) {
  const rows = data.map((d) => ({ date: d.date, revenue: d.earnings, spend: -d.spend, profit: d.profit }));
  const labels: Record<string, string> = { profit: 'Profit', revenue: 'Revenue', spend: 'Spend' };
  return (
    <ResponsiveContainer width="100%" height={360}>
      <ComposedChart data={rows} stackOffset="sign" margin={{ top: 0, right: 16, left: 8, bottom: 0 }} barCategoryGap="22%">
        <CartesianGrid stroke={gridStroke} />
        <XAxis dataKey="date" tickLine={false} axisLine={{ stroke: '#ccc' }} tick={axisTick} tickFormatter={dayFormatter(data)}
          interval="preserveStartEnd" minTickGap={8} />
        <YAxis tickLine={false} axisLine={{ stroke: '#ccc' }} tick={axisTick} tickFormatter={usdAxis} width={56}
          label={{ value: 'Revenue / Spend (USD)', angle: -90, position: 'insideLeft', offset: 4, style: { fill: '#555', fontSize: 11, textAnchor: 'middle' } }} />
        <ReferenceLine y={0} stroke="#2c4a6b" strokeWidth={1.5} />
        <Tooltip
          contentStyle={tooltipStyle}
          cursor={{ fill: '#f2f2f2' }}
          formatter={(v, key) => [money(key === 'spend' ? -Number(v) : Number(v)), labels[String(key)]]}
        />
        <Legend verticalAlign="top" align="center" height={28} iconType="rect" iconSize={14}
          payload={(['profit', 'revenue', 'spend'] as const).map((k) => ({ value: k, type: 'rect', color: COLORS[k] }))}
          formatter={(key) => <span style={{ color: '#444', fontSize: 11 }}>{labels[String(key)]}</span>} />
        <Bar dataKey="revenue" stackId="money" fill={COLORS.revenue} maxBarSize={60} />
        <Bar dataKey="spend" stackId="money" fill={COLORS.spend} maxBarSize={60} />
        <Line type="linear" dataKey="profit" stroke={COLORS.profit} strokeWidth={1.5} dot={false}
          activeDot={{ r: 4, fill: COLORS.profit, stroke: '#fff', strokeWidth: 2 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Biểu đồ nhỏ 1 chỉ số theo ngày; tiêu đề kèm tổng hoặc trung bình, ví dụ "Install (Total: 57,424)". */
export function MiniChart({ title, statLabel, stat, data, field, fmt, axisFmt, signed }: {
  title: string;
  statLabel: 'Total' | 'Avg';
  stat: number;
  data: TimePoint[];
  field: keyof TimePoint;
  fmt: (v: number) => string;
  axisFmt?: (v: number) => string;
  /** Chỉ số có thể âm (lợi nhuận): số tổng âm tô đỏ. */
  signed?: boolean;
}) {
  // Lợi nhuận: đoạn trên 0 màu xanh lá, dưới 0 màu đỏ (gradient cắt đúng tại mức 0).
  const values = data.map((d) => Number(d[field]) || 0);
  const [min, max, ticks] = niceRange(Math.min(0, ...values), Math.max(0, ...values));
  const zeroAt = max === min ? 1 : max / (max - min);
  const gradientId = `split-${String(field)}`;
  const stroke = signed ? `url(#${gradientId})` : COLORS.line;
  return (
    <section className="mini-chart">
      <h3>
        {title} (<span className={signed && stat < 0 ? 'neg' : 'pos'}>{statLabel}: {fmt(stat)}</span>)
      </h3>
      <div className="mini-legend">
        {signed ? (
          <><i style={{ background: COLORS.gain }} />Lãi <i style={{ background: COLORS.zero }} />Lỗ</>
        ) : (
          <><i style={{ background: COLORS.line }} />All</>
        )}
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
          {signed && (
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset={zeroAt} stopColor={COLORS.gain} />
                <stop offset={zeroAt} stopColor={COLORS.zero} />
              </linearGradient>
            </defs>
          )}
          <CartesianGrid stroke={gridStroke} />
          <XAxis dataKey="date" tickLine={false} axisLine={{ stroke: '#ccc' }} tick={axisTick} tickFormatter={dayFormatter(data)}
            interval="preserveStartEnd" minTickGap={8} />
          <YAxis tickLine={false} axisLine={{ stroke: '#ccc' }} tick={axisTick} width={52} tickFormatter={axisFmt ?? compact}
            domain={signed ? [min, max] : undefined} ticks={signed ? ticks : undefined} />
          <ReferenceLine y={0} stroke={COLORS.zero} strokeWidth={1.5} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => [fmt(Number(v)), title]} />
          <Line type="linear" dataKey={field} stroke={stroke} strokeWidth={2} dot={false}
            activeDot={(p: { cx?: number; cy?: number; value?: number }) => (
              <circle cx={p.cx} cy={p.cy} r={4} stroke="#fff" strokeWidth={2}
                fill={signed ? ((p.value ?? 0) < 0 ? COLORS.zero : COLORS.gain) : COLORS.line} />
            )} />
        </LineChart>
      </ResponsiveContainer>
    </section>
  );
}

/** Trục có mốc tròn (1, 2, 5 × 10ⁿ) và luôn đi qua 0, để vạch đổi màu lãi/lỗ nằm đúng mốc 0. */
function niceRange(lo: number, hi: number): [number, number, number[]] {
  if (lo === hi) return [lo, hi + 1, [lo, hi + 1]];
  const raw = (hi - lo) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((x) => x >= raw)!;
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let t = start; t <= end + step / 2; t += step) ticks.push(Number(t.toFixed(10)));
  return [start, end, ticks];
}
