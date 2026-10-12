import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, qs } from '../api';
import { filterQuery, Filters, useFilters } from '../components/Filters';
import { MetricsTable } from '../components/MetricsTable';
import { ChartMetric, RevenueChart } from '../components/RevenueChart';
import { UpdateButton } from '../components/UpdateButton';
import { compact, delta, money, num, pct, ratio } from '../format';
import type { BreakdownRow, Metrics, SpendMetrics, Summary, TimePoint } from '../types';

export function DashboardPage() {
  const [filters, setFilters] = useFilters();
  const [metric, setMetric] = useState<ChartMetric>('earnings');
  const navigate = useNavigate();
  const q = qs(filterQuery(filters));

  const summary = useQuery({ queryKey: ['reports', 'summary', q], queryFn: () => api<Summary>(`/reports/summary?${q}`) });
  const series = useQuery({
    queryKey: ['reports', 'timeseries', q],
    queryFn: () => api<TimePoint[]>(`/reports/timeseries?${q}&granularity=day`),
  });
  const byApp = useQuery({
    queryKey: ['reports', 'breakdown', 'app', q],
    queryFn: () => api<BreakdownRow[]>(`/reports/breakdown?${q}&dimension=app`),
  });

  const cur = summary.data?.current;
  const prev = summary.data?.previous;
  const hasSpend = !!(cur?.spend || prev?.spend);

  return (
    <>
      <header className="page-header">
        <h1>Tổng quan doanh thu</h1>
        <UpdateButton />
      </header>
      <Filters value={filters} onChange={setFilters} />

      <section className="kpis">
        <Kpi label="Doanh thu ước tính" field="earnings" cur={cur} prev={prev} fmt={money} />
        <Kpi label="eCPM" field="ecpm" cur={cur} prev={prev} fmt={money} />
        <Kpi label="Impressions" field="impressions" cur={cur} prev={prev} fmt={num} />
        <Kpi label="Ad requests" field="adRequests" cur={cur} prev={prev} fmt={compact} />
        <Kpi label="Match rate" field="matchRate" cur={cur} prev={prev} fmt={pct} />
        <Kpi label="Show rate" field="showRate" cur={cur} prev={prev} fmt={pct} />
      </section>
      {hasSpend && (
        <section className="kpis">
          <Kpi label="Chi phí Facebook" field="spend" cur={cur} prev={prev} fmt={money} invert />
          <Kpi label="Lợi nhuận" field="profit" cur={cur} prev={prev} fmt={money} />
          <Kpi label="ROAS" field="roas" cur={cur} prev={prev} fmt={ratio} />
          <Kpi label="Installs" field="installs" cur={cur} prev={prev} fmt={num} />
          <Kpi label="CPI" field="cpi" cur={cur} prev={prev} fmt={money} invert />
        </section>
      )}
      {summary.data && (
        <p className="small muted">
          So với kỳ trước: {summary.data.previousRange.from} → {summary.data.previousRange.to}
        </p>
      )}

      <section className="card">
        <div className="card-header">
          <h2>Theo ngày</h2>
          <div className="presets">
            {(hasSpend ? (['earnings', 'profit', 'ecpm', 'impressions'] as const) : (['earnings', 'ecpm', 'impressions'] as const)).map((m) => (
              <button key={m} className={metric === m ? 'chip active' : 'chip'} onClick={() => setMetric(m)}>
                {{ earnings: hasSpend ? 'Doanh thu & chi phí' : 'Doanh thu', profit: 'Lợi nhuận', ecpm: 'eCPM', impressions: 'Impressions' }[m]}
              </button>
            ))}
          </div>
        </div>
        {series.isLoading ? <div className="chart-placeholder muted">Đang tải…</div> : <RevenueChart data={series.data ?? []} metric={metric} showSpend={hasSpend} />}
      </section>

      <h2>Theo ứng dụng</h2>
      <MetricsTable title="Ứng dụng" rows={byApp.data ?? []} showSpend={hasSpend}
        onRowClick={(r) => r.key !== '__unmatched__' && navigate(`/breakdown?${qs({ ...filterQuery(filters), apps: [r.key], appIds: undefined })}`)} />
    </>
  );
}

function Kpi({ label, field, cur, prev, fmt, invert }: {
  label: string;
  field: keyof (Metrics & SpendMetrics);
  cur?: Metrics & SpendMetrics;
  prev?: Metrics & SpendMetrics;
  fmt: (v: number) => string;
  /** Chỉ số càng thấp càng tốt (chi phí, CPI): tăng thì tô màu xấu. */
  invert?: boolean;
}) {
  const d = cur && prev ? delta(cur[field], prev[field]) : null;
  const good = d !== null && (invert ? d <= 0 : d >= 0);
  return (
    <div className="card kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{cur ? fmt(cur[field]) : '—'}</div>
      <div className={`kpi-delta ${d === null ? 'muted' : good ? 'up' : 'down'}`}>
        {d === null ? '—' : `${d >= 0 ? '▲' : '▼'} ${pct(Math.abs(d))}`}
      </div>
    </div>
  );
}
