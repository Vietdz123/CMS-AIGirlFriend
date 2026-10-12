import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { countryOptions, daysAgo, formatName } from '../format';
import { DateRangePicker } from './DateRangePicker';
import { SearchSelect } from './SearchSelect';
import type { AppInfo } from '../types';

export interface FilterValues {
  from: string;
  to: string;
  appIds: string[];
  formats: string[];
  countries: string[];
}

const PRESETS = [
  { label: 'Hôm nay', days: 0 },
  { label: '7 ngày', days: 6 },
  { label: '30 ngày', days: 29 },
  { label: '90 ngày', days: 89 },
];

const split = (v: string | null) => (v ? v.split(',').filter(Boolean) : []);

/** Bộ lọc lưu trên URL để share link / reload không mất trạng thái. */
export function useFilters(): [FilterValues, (patch: Partial<FilterValues>) => void] {
  const [params, setParams] = useSearchParams();
  const values: FilterValues = {
    from: params.get('from') ?? daysAgo(6),
    to: params.get('to') ?? daysAgo(0),
    appIds: split(params.get('apps')),
    formats: split(params.get('formats')),
    countries: split(params.get('countries')),
  };
  const update = (patch: Partial<FilterValues>) => {
    const next = { ...values, ...patch };
    const p = new URLSearchParams(params);
    p.set('from', next.from);
    p.set('to', next.to);
    for (const [key, list] of [['apps', next.appIds], ['formats', next.formats], ['countries', next.countries]] as const) {
      if (list.length) p.set(key, list.join(','));
      else p.delete(key);
    }
    setParams(p, { replace: true });
  };
  return [values, update];
}

export function filterQuery(f: FilterValues) {
  return { from: f.from, to: f.to, appIds: f.appIds, formats: f.formats, countries: f.countries };
}

export function Filters({ value, onChange }: { value: FilterValues; onChange: (p: Partial<FilterValues>) => void }) {
  const apps = useQuery({ queryKey: ['apps'], queryFn: () => api<AppInfo[]>('/admob/apps') });
  const options = useQuery({
    queryKey: ['reports', 'filters'],
    queryFn: () => api<{ formats: string[]; countries: string[] }>('/reports/filters'),
  });

  return (
    <div className="filters">
      <div className="presets">
        {PRESETS.map((p) => {
          const active = value.from === daysAgo(p.days) && value.to === daysAgo(0);
          return (
            <button key={p.label} className={active ? 'chip active' : 'chip'}
              onClick={() => onChange({ from: daysAgo(p.days), to: daysAgo(0) })}>
              {p.label}
            </button>
          );
        })}
      </div>
      <DateRangePicker from={value.from} to={value.to} onChange={onChange} />
      <Select label="App" value={value.appIds} onChange={(appIds) => onChange({ appIds })}
        options={(apps.data ?? []).map((a) => ({ value: a.id, label: a.name }))} />
      <Select label="Format" value={value.formats} onChange={(formats) => onChange({ formats })}
        options={(options.data?.formats ?? []).map((f) => ({ value: f, label: formatName(f) }))} />
      <label>
        Quốc gia
        <SearchSelect value={value.countries} allLabel="Tất cả" placeholder="Gõ tên hoặc mã nước…" width={240}
          options={countryOptions(options.data?.countries ?? [])}
          onChange={(countries) => onChange({ countries })} />
      </label>
    </div>
  );
}

/** Select 1 giá trị hoặc "Tất cả" — đủ dùng cho bộ lọc, giữ dạng mảng để mở rộng multi-select sau. */
function Select({ label, value, options, onChange }: {
  label: string;
  value: string[];
  options: { value: string; label: string }[];
  onChange: (v: string[]) => void;
}) {
  return (
    <label>
      {label}
      <select value={value[0] ?? ''} onChange={(e) => onChange(e.target.value ? [e.target.value] : [])}>
        <option value="">Tất cả</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
