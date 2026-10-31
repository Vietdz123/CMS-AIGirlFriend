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
import type { IapDetailRow, TimePoint } from '../types';

/** Màu theo kiểu dashboard Monet & UA: doanh thu xanh lơ, chi phí vàng cam, lợi nhuận xanh đậm, chart nhỏ xanh thép. */
export const COLORS = { revenue: '#00a5d6', iap: '#7c4dff', spend: '#eda100', profit: '#2c4a6b', line: '#3c78b5', zero: '#e02424', gain: '#16a34a' };

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
export function ProfitOverviewChart({ data, currency = 'USD', fmt = money, withIap = false }: {
  data: TimePoint[];
  /** Đơn vị đang hiện (USD hoặc VND); data đã được đổi sẵn. */
  currency?: string;
  fmt?: (v: number) => string;
  /** Có cột IAP (thực nhận) chồng trên cột doanh thu quảng cáo. */
  withIap?: boolean;
}) {
  // Cột dương = quảng cáo (+ IAP thực nhận), cột âm = chi phí, nên tổng cột = đường lợi nhuận.
  const rows = data.map((d) => ({ date: d.date, revenue: d.earnings, iap: withIap ? d.iapNet : 0, spend: -d.spend, profit: d.profit }));
  const labels: Record<string, string> = { profit: 'Profit', revenue: 'Ads Revenue', iap: 'IAP thực nhận', spend: 'Spend' };
  const legend = (withIap ? ['profit', 'revenue', 'iap', 'spend'] : ['profit', 'revenue', 'spend']) as (keyof typeof COLORS)[];
  return (
    <ResponsiveContainer width="100%" height={360}>
      <ComposedChart data={rows} stackOffset="sign" margin={{ top: 0, right: 16, left: 8, bottom: 0 }} barCategoryGap="22%">
        <CartesianGrid stroke={gridStroke} />
        <XAxis dataKey="date" tickLine={false} axisLine={{ stroke: '#ccc' }} tick={axisTick} tickFormatter={dayFormatter(data)}
          interval="preserveStartEnd" minTickGap={8} />
        <YAxis tickLine={false} axisLine={{ stroke: '#ccc' }} tick={axisTick} tickFormatter={usdAxis} width={56}
          label={{ value: `Revenue / Spend (${currency})`, angle: -90, position: 'insideLeft', offset: 4, style: { fill: '#555', fontSize: 11, textAnchor: 'middle' } }} />
        <ReferenceLine y={0} stroke="#2c4a6b" strokeWidth={1.5} />
        <Tooltip
          contentStyle={tooltipStyle}
          cursor={{ fill: '#f2f2f2' }}
          formatter={(v, key) => [fmt(key === 'spend' ? -Number(v) : Number(v)), labels[String(key)]]}
        />
        <Legend verticalAlign="top" align="center" height={28} iconType="rect" iconSize={14}
          payload={legend.map((k) => ({ value: k, type: 'rect', color: COLORS[k] }))}
          formatter={(key) => <span style={{ color: '#444', fontSize: 11 }}>{labels[String(key)]}</span>} />
        <Bar dataKey="revenue" stackId="money" fill={COLORS.revenue} maxBarSize={60} />
        {withIap && <Bar dataKey="iap" stackId="money" fill={COLORS.iap} maxBarSize={60} />}
        <Bar dataKey="spend" stackId="money" fill={COLORS.spend} maxBarSize={60} />
        <Line type="linear" dataKey="profit" stroke={COLORS.profit} strokeWidth={1.5} dot={false}
          activeDot={{ r: 4, fill: COLORS.profit, stroke: '#fff', strokeWidth: 2 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Biểu đồ nhỏ 1 chỉ số theo ngày; tiêu đề kèm tổng hoặc trung bình, ví dụ "Install (Total: 57,424)". */
export function MiniChart({ title, statLabel, stat, data, field, fmt, axisFmt, signed, color = COLORS.line }: {
  title: string;
  statLabel: 'Total' | 'Avg';
  stat: number;
  data: TimePoint[];
  field: keyof TimePoint;
  fmt: (v: number) => string;
  axisFmt?: (v: number) => string;
  /** Chỉ số có thể âm (lợi nhuận): số tổng âm tô đỏ. */
  signed?: boolean;
  /** Màu đường (mặc định xanh); không dùng khi signed. */
  color?: string;
}) {
  // Lợi nhuận: đoạn trên 0 màu xanh lá, dưới 0 màu đỏ (gradient cắt đúng tại mức 0).
  const values = data.map((d) => Number(d[field]) || 0);
  const [min, max, ticks] = niceRange(Math.min(0, ...values), Math.max(0, ...values));
  const zeroAt = max === min ? 1 : max / (max - min);
  const gradientId = `split-${String(field)}`;
  const stroke = signed ? `url(#${gradientId})` : color;
  return (
    <section className="mini-chart">
      <h3>
        {title} (<span className={signed && stat < 0 ? 'neg' : 'pos'}>{statLabel}: {fmt(stat)}</span>)
      </h3>
      <div className="mini-legend">
        {signed ? (
          <><i style={{ background: COLORS.gain }} />Lãi <i style={{ background: COLORS.zero }} />Lỗ</>
        ) : (
          <><i style={{ background: color }} />All</>
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
                fill={signed ? ((p.value ?? 0) < 0 ? COLORS.zero : COLORS.gain) : color} />
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

/**
 * IAP theo ngày: cột = thực nhận ước tính (trục trái, tiền), đường = số đơn (trục phải). Rê chuột hiện rev, số đơn và
 * các gói đã bán trong ngày (tên gói x số đơn, nước).
 */
export function IapChart({ data, detail, fmt, stat }: {
  data: TimePoint[];
  /** Dòng chi tiết ngày x nước x gói (bảng Gói IAP) để liệt kê gói trong tooltip. */
  detail: IapDetailRow[];
  fmt: (v: number) => string;
  stat: { net: number; orders: number };
}) {
  const packs = new Map<string, { sku: string; country: string; orders: number }[]>();
  for (const d of detail) packs.set(d.date, [...(packs.get(d.date) ?? []), { sku: d.sku, country: d.country, orders: d.orders - d.refunds }]);
  const rows = data.map((d) => ({ date: d.date, net: d.iapNet, orders: d.iapOrders }));
  return (
    <section className="mini-chart">
      <h3>
        IAP thực nhận ~ (<span className="pos">Total: {fmt(stat.net)}</span> · {stat.orders} đơn)
      </h3>
      <div className="mini-legend">
        <i style={{ background: COLORS.iap }} />Thực nhận <i style={{ background: COLORS.line, height: 3 }} />Số đơn
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={rows} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={gridStroke} />
          <XAxis dataKey="date" tickLine={false} axisLine={{ stroke: '#ccc' }} tick={axisTick} tickFormatter={dayFormatter(data)}
            interval="preserveStartEnd" minTickGap={8} />
          <YAxis yAxisId="rev" tickLine={false} axisLine={{ stroke: '#ccc' }} tick={axisTick} width={52} tickFormatter={compact} />
          <YAxis yAxisId="orders" orientation="right" allowDecimals={false} tickLine={false} axisLine={{ stroke: '#ccc' }}
            tick={axisTick} width={28} />
          <Tooltip content={({ active, label }) => {
            if (!active || !label) return null;
            const row = rows.find((r) => r.date === label);
            const list = packs.get(String(label)) ?? [];
            return (
              <div style={{ ...tooltipStyle, padding: '8px 10px' }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
                <div>Thực nhận ~ <b>{fmt(row?.net ?? 0)}</b></div>
                <div>Số đơn <b>{row?.orders ?? 0}</b></div>
                {list.length > 0 && (
                  <div style={{ marginTop: 6, borderTop: '1px solid #eee', paddingTop: 6 }}>
                    {list.map((p) => <div key={`${p.sku}|${p.country}`}>{p.sku} × {p.orders} <span style={{ color: '#888' }}>({p.country})</span></div>)}
                  </div>
                )}
              </div>
            );
          }} />
          <Bar yAxisId="rev" dataKey="net" fill={COLORS.iap} maxBarSize={36} />
          <Line yAxisId="orders" type="linear" dataKey="orders" stroke={COLORS.line} strokeWidth={2} dot={false}
            activeDot={{ r: 4, fill: COLORS.line, stroke: '#fff', strokeWidth: 2 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </section>
  );
}
