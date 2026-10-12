import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../api';
import { filterQuery, Filters, useFilters } from '../components/Filters';
import { MetricsTable } from '../components/MetricsTable';
import { UpdateButton } from '../components/UpdateButton';
import { countryName, formatName } from '../format';
import type { BreakdownRow } from '../types';

const TABS = [
  { key: 'adUnit', label: 'Ad unit' },
  { key: 'format', label: 'Format' },
  { key: 'country', label: 'Quốc gia' },
  { key: 'adSource', label: 'Mạng quảng cáo (mediation)' },
  { key: 'app', label: 'Ứng dụng' },
  { key: 'account', label: 'Tài khoản AdMob' },
] as const;

type Tab = (typeof TABS)[number]['key'];

export function BreakdownPage() {
  const [filters, setFilters] = useFilters();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('by') as Tab) ?? 'adUnit';
  const q = qs(filterQuery(filters));

  const data = useQuery({
    queryKey: ['reports', 'breakdown', tab, q],
    queryFn: () => api<BreakdownRow[]>(`/reports/breakdown?${q}&dimension=${tab}&limit=500`),
  });

  const rows = (data.data ?? []).map((r) => ({
    ...r,
    label: tab === 'country' ? `${countryName(r.key)} (${r.key})` : tab === 'format' ? formatName(r.key) : r.label,
  }));

  function drill(key: string) {
    if (tab === 'app') setFilters({ appIds: [key] });
    if (tab === 'format') setFilters({ formats: [key] });
    if (tab === 'country') setFilters({ countries: [key] });
  }

  const setTab = (by: Tab) => {
    const p = new URLSearchParams(params);
    p.set('by', by);
    setParams(p, { replace: true });
  };

  return (
    <>
      <header className="page-header">
        <h1>Phân tích chi tiết</h1>
        <UpdateButton />
      </header>
      <Filters value={filters} onChange={setFilters} />
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'tab active' : 'tab'} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'adSource' && (
        <p className="small muted">
          Doanh thu theo từng mạng trong mediation. Bộ lọc quốc gia không áp dụng cho chế độ xem này.
        </p>
      )}
      {data.isLoading ? (
        <div className="card center muted">Đang tải…</div>
      ) : (
        <MetricsTable
          title={TABS.find((t) => t.key === tab)!.label}
          rows={rows}
          hideRequests={tab === 'adSource'}
          onRowClick={['app', 'format', 'country'].includes(tab) ? (r) => drill(r.key) : undefined}
        />
      )}
    </>
  );
}
