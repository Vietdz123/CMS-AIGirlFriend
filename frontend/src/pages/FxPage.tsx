import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, del, put, qs } from '../api';
import { useAuth } from '../auth';
import { DateRangePicker } from '../components/DateRangePicker';
import { daysAgo } from '../format';

interface FxRow {
  date: string;
  rate: number;
  manual: boolean;
}

/** Cách nhập tỷ giá: "usd" = 1 USD bằng bao nhiêu tiền gốc; "local" = 1 đơn vị tiền gốc bằng bao nhiêu USD. */
type Mode = 'usd' | 'local';

const fmtRate = (v: number) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(v);
const fmtInverse = (v: number) => (1 / v).toPrecision(4);

/**
 * Tỷ giá quy đổi chi phí quảng cáo sang USD theo từng ngày. Admin sửa được (nhập theo USD hoặc theo tiền gốc); sửa xong
 * mọi số USD đã lưu của những ngày đó (chi phí, conversion value, budget, ROAS, lịch sử chi phí) được tính lại.
 */
export function FxPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [range, setRange] = useState({ from: daysAgo(30), to: daysAgo(0) });
  const currencies = useQuery({ queryKey: ['fx', 'currencies'], queryFn: () => api<string[]>('/fx/currencies') });
  const [currency, setCurrency] = useState('');
  useEffect(() => {
    if (!currency && currencies.data?.length) setCurrency(currencies.data[0]);
  }, [currency, currencies.data]);
  const rates = useQuery({
    queryKey: ['fx', 'rates', currency, range.from, range.to],
    queryFn: () => api<FxRow[]>(`/fx/rates?${qs({ currency, ...range })}`),
    enabled: !!currency,
  });

  // Ô sửa: khoảng ngày + giá trị theo cách nhập đang chọn.
  const [edit, setEdit] = useState({ from: daysAgo(0), to: daysAgo(0) });
  const [mode, setMode] = useState<Mode>('usd');
  const [value, setValue] = useState('');
  // Dấu phẩy / khoảng trắng là phân cách hàng nghìn ("25,850"), dấu chấm là thập phân ("0.0000387").
  const parsed = Number(value.replace(/[\s,]/g, ''));
  const rate = !value || !(parsed > 0) ? null : mode === 'usd' ? parsed : 1 / parsed;

  const refresh = () => queryClient.invalidateQueries();
  const save = useMutation({
    mutationFn: () => put('/fx/rates', { currency, ...edit, rate }),
    onSuccess: () => {
      setValue('');
      refresh();
    },
  });
  const reset = useMutation({
    mutationFn: (date: string) => del(`/fx/rates?${qs({ currency, date })}`),
    onSuccess: refresh,
  });

  return (
    <>
      <header className="page-header"><h1>Tỷ giá</h1></header>
      <p className="small muted">
        Chi phí quảng cáo của tài khoản không tính bằng USD (ví dụ Google Ads tính VND) được đổi sang USD theo tỷ giá từng
        ngày để so với doanh thu AdMob. Mặc định lấy tỷ giá thị trường; admin có thể sửa tay (ví dụ theo tỷ giá ngân hàng
        lúc nạp tiền). Sửa xong, chi phí, conversion value, budget, ROAS của những ngày đó được tính lại ngay.
      </p>

      <div className="filters">
        <label>
          Tiền tệ
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {currencies.data?.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <DateRangePicker from={range.from} to={range.to} onChange={setRange} />
      </div>
      {currencies.data?.length === 0 && (
        <div className="card center muted">Mọi tài khoản quảng cáo đều tính bằng USD, không cần tỷ giá.</div>
      )}

      {can('ADMIN') && currency && (
        <div className="card fx-edit">
          <b>Sửa tỷ giá</b>
          <div className="filters">
            <label>Ngày <DateRangePicker from={edit.from} to={edit.to} onChange={setEdit} /></label>
            <label>
              Nhập theo
              <select value={mode} onChange={(e) => { setMode(e.target.value as Mode); setValue(''); }}>
                <option value="usd">1 USD = ? {currency}</option>
                <option value="local">1 {currency} = ? USD</option>
              </select>
            </label>
            <label>
              {mode === 'usd' ? `${currency} cho 1 USD` : `USD cho 1 ${currency}`}
              <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal"
                placeholder={mode === 'usd' ? 'ví dụ 25850' : 'ví dụ 0.0000387'} style={{ width: 140 }} />
            </label>
            <button className="primary" disabled={!rate || save.isPending}
              onClick={() => confirm(`Đặt 1 USD = ${fmtRate(rate!)} ${currency} cho ${edit.from} → ${edit.to}? Số USD của những ngày này sẽ được tính lại.`) && save.mutate()}>
              {save.isPending ? 'Đang lưu…' : 'Lưu'}
            </button>
          </div>
          {rate && (
            <p className="small muted">
              = 1 USD = <b>{fmtRate(rate)}</b> {currency} · 1 {currency} = <b>{fmtInverse(rate)}</b> USD
            </p>
          )}
          {save.isError && <p className="small error-text">{(save.error as Error).message}</p>}
        </div>
      )}

      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Ngày</th>
              <th className="num">1 USD = ? {currency}</th>
              <th className="num">1 {currency} = ? USD</th>
              <th>Nguồn</th>
              {can('ADMIN') && <th />}
            </tr>
          </thead>
          <tbody>
            {rates.data?.map((r) => (
              <tr key={r.date}>
                <td>{r.date}</td>
                <td className="num">{fmtRate(r.rate)}</td>
                <td className="num muted">{fmtInverse(r.rate)}</td>
                <td>{r.manual ? <span className="badge info">Sửa tay</span> : <span className="muted">Thị trường</span>}</td>
                {can('ADMIN') && (
                  <td>
                    <button className="link" onClick={() => { setEdit({ from: r.date, to: r.date }); setMode('usd'); setValue(String(r.rate)); }}>
                      Sửa
                    </button>
                    {r.manual && (
                      <button className="link" disabled={reset.isPending}
                        onClick={() => confirm(`Bỏ tỷ giá sửa tay ngày ${r.date}, quay về tỷ giá thị trường?`) && reset.mutate(r.date)}>
                        {' '}Về thị trường
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {rates.isLoading && <tr><td colSpan={5} className="center muted">Đang tải…</td></tr>}
            {reset.isError && <tr><td colSpan={5} className="center error-text">{(reset.error as Error).message}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
