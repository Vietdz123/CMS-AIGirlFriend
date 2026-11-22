import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, ApiError, del, qs, token } from '../api';
import { useAuth } from '../auth';
import { DateRangePicker } from '../components/DateRangePicker';
import { SearchSelect } from '../components/SearchSelect';
import { daysAgo } from '../format';

type Direction = 'IN' | 'OUT';

interface Payment {
  id: string;
  direction: Direction;
  date: string;
  party: string;
  amount: number;
  currency: string;
  note: string | null;
  hasReceipt: boolean;
  receiptName: string | null;
}

const CURRENCIES = ['VND', 'USD', 'HKD'];
/** Người thanh toán / người nhận tiền: chỉ 2 người này (trùng danh sách PARTIES ở backend). */
export const PARTIES = ['Trịnh Tiến Việt', 'Nguyễn Dương Huyền Trang'];
const LABEL: Record<Direction, string> = { IN: 'Nhận', OUT: 'Chi' };

const amountText = (v: number, currency: string) => {
  try {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency, maximumFractionDigits: currency === 'VND' ? 0 : 2 }).format(v);
  } catch {
    return `${v} ${currency}`;
  }
};

/** Gửi multipart (form có file): không đặt Content-Type để trình duyệt tự thêm boundary. */
async function sendForm<T>(path: string, method: 'POST' | 'PATCH', form: FormData): Promise<T> {
  const t = token.get();
  const res = await fetch(`/api${path}`, { method, body: form, headers: t ? { Authorization: `Bearer ${t}` } : {} });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (Array.isArray(body.message) ? body.message.join(', ') : body.message) ?? res.statusText);
  }
  return res.json();
}

/** Ảnh hoá đơn cần header Authorization nên tải bằng fetch rồi tạo object URL. */
function useReceiptUrl(id: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    let objectUrl: string | null = null;
    const t = token.get();
    fetch(`/api/payments/${id}/receipt`, { headers: t ? { Authorization: `Bearer ${t}` } : {} })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (!b) return;
        objectUrl = URL.createObjectURL(b);
        setUrl(objectUrl);
      });
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [id]);
  return url;
}

/** Payments: khoản tiền nhận / chi nhập tay, kèm ảnh hoá đơn. Lọc theo khoảng ngày và loại khoản. */
export function PaymentsPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  // Mặc định "Lifetime": không lọc ngày (mọi khoản, từ hoá đơn xa nhất tới hôm nay); chọn ngày thì lọc theo khoảng đó.
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const bounds = useQuery({
    queryKey: ['payments', 'range'],
    queryFn: () => api<{ first: string | null; last: string | null }>('/payments/range'),
  });
  const today = daysAgo(0);
  const shown = range ?? { from: bounds.data?.first ?? today, to: today };
  // Mặc định xem khoản chi.
  const [direction, setDirection] = useState<'' | Direction>('OUT');
  const [search, setSearch] = useState('');
  const [parties, setParties] = useState<string[]>([]);
  const [editing, setEditing] = useState<Payment | 'new' | null>(null);
  const [viewing, setViewing] = useState<Payment | null>(null);

  const q = qs({ ...(range ?? {}), direction, parties, q: search.trim() || undefined });
  const data = useQuery({ queryKey: ['payments', q], queryFn: () => api<Payment[]>(`/payments?${q}`) });
  const partyList = useQuery({
    queryKey: ['payments', 'parties'],
    queryFn: () => api<{ party: string; count: number }[]>('/payments/parties'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/payments/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['payments'] }),
  });
  const rows = data.data ?? [];

  // Tổng theo tiền tệ (không cộng lẫn VND với USD).
  const totals = new Map<string, { in: number; out: number }>();
  for (const r of rows) {
    const t = totals.get(r.currency) ?? { in: 0, out: 0 };
    if (r.direction === 'IN') t.in += r.amount;
    else t.out += r.amount;
    totals.set(r.currency, t);
  }

  return (
    <>
      <header className="page-header">
        <h1>Payments</h1>
        <button className="primary" onClick={() => setEditing('new')}>+ Thêm khoản tiền</button>
      </header>

      <div className="filters">
        <DateRangePicker from={shown.from} to={shown.to} onChange={setRange} />
        <button className={range ? '' : 'primary'} title="Mọi khoản, từ hoá đơn xa nhất tới hôm nay" onClick={() => setRange(null)}>
          Lifetime
        </button>
        <div className="seg">
          {(['', 'IN', 'OUT'] as const).map((d) => (
            <button key={d} className={direction === d ? 'active' : ''} onClick={() => setDirection(d)}>
              {d ? LABEL[d] : 'Tất cả'}
            </button>
          ))}
        </div>
        <label>
          Người trả / nhận
          <SearchSelect value={parties} onChange={setParties} allLabel="Tất cả" placeholder="Gõ tên…" width={220}
            options={PARTIES.map((p) => {
              const n = partyList.data?.find((x) => x.party === p)?.count ?? 0;
              return { value: p, label: `${p} (${n})` };
            })} />
        </label>
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm trong ghi chú / tên…" />
      </div>

      {/* Mỗi loại tiền 1 hàng: tổng nhận, tổng chi, chênh lệch (theo đúng bộ lọc đang chọn). */}
      {[...totals].map(([cur, t]) => (
        <section key={cur} className="kpis">
          <div className="card kpi">
            <div className="kpi-label">Tổng nhận ({cur})</div>
            <div className="kpi-value success-text">+{amountText(t.in, cur)}</div>
          </div>
          <div className="card kpi">
            <div className="kpi-label">Tổng chi ({cur})</div>
            <div className="kpi-value error-text">−{amountText(t.out, cur)}</div>
          </div>
          <div className="card kpi">
            <div className="kpi-label">Chênh lệch ({cur})</div>
            <div className={`kpi-value ${t.in - t.out < 0 ? 'error-text' : 'success-text'}`}>
              {t.in - t.out < 0 ? '−' : '+'}{amountText(Math.abs(t.in - t.out), cur)}
            </div>
          </div>
        </section>
      ))}

      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Ngày</th>
              <th>Loại</th>
              <th>Người trả / nhận</th>
              <th className="num">Khoản tiền</th>
              <th>Ghi chú</th>
              <th>Hoá đơn</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.date}</td>
                <td><span className={`badge ${r.direction === 'IN' ? 'success' : 'error'}`}>{LABEL[r.direction]}</span></td>
                <td>{r.party}</td>
                <td className={`num ${r.direction === 'IN' ? 'pos' : 'neg'}`}>
                  {r.direction === 'IN' ? '+' : '−'}{amountText(r.amount, r.currency)}
                </td>
                <td className="small muted">{r.note}</td>
                <td>{r.hasReceipt ? <button className="link" onClick={() => setViewing(r)}>Xem ảnh</button> : <span className="muted">—</span>}</td>
                <td>
                  <button className="link" onClick={() => setEditing(r)}>Sửa</button>
                  {can('ADMIN') && (
                    <button className="link danger" disabled={remove.isPending}
                      onClick={() => confirm(`Xoá khoản ${LABEL[r.direction].toLowerCase()} ${amountText(r.amount, r.currency)} của ${r.party}?`) && remove.mutate(r.id)}>
                      {' '}Xoá
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {data.isLoading && <tr><td colSpan={7} className="center muted">Đang tải…</td></tr>}
            {data.isError && <tr><td colSpan={7} className="center error-text">{(data.error as Error).message}</td></tr>}
            {!data.isLoading && !data.isError && !rows.length && <tr><td colSpan={7} className="center muted">Chưa có khoản tiền nào trong khoảng này.</td></tr>}
          </tbody>
        </table>
      </div>

      {editing && <PaymentForm payment={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {viewing && <ReceiptViewer payment={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

function PaymentForm({ payment, onClose }: { payment: Payment | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [direction, setDirection] = useState<Direction>(payment?.direction ?? 'OUT');
  const [date, setDate] = useState(payment?.date ?? daysAgo(0));
  const [party, setParty] = useState(payment?.party ?? PARTIES[0]);
  const [amount, setAmount] = useState(payment ? String(payment.amount) : '');
  const [currency, setCurrency] = useState(payment?.currency ?? 'VND');
  const [note, setNote] = useState(payment?.note ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [removeReceipt, setRemoveReceipt] = useState(false);
  const preview = file ? URL.createObjectURL(file) : null;
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const save = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append('direction', direction);
      form.append('date', date);
      form.append('party', party);
      form.append('amount', amount);
      form.append('currency', currency);
      form.append('note', note);
      if (file) form.append('receipt', file);
      if (removeReceipt && !file) form.append('removeReceipt', '1');
      return payment ? sendForm(`/payments/${payment.id}`, 'PATCH', form) : sendForm('/payments', 'POST', form);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      onClose();
    },
  });

  return (
    <div className="modal-backdrop">
      <form className="card modal" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <h2>{payment ? 'Sửa khoản tiền' : 'Thêm khoản tiền'}</h2>
        <div className="seg">
          {(['IN', 'OUT'] as const).map((d) => (
            <button type="button" key={d} className={direction === d ? 'active' : ''} onClick={() => setDirection(d)}>
              {d === 'IN' ? 'Khoản nhận' : 'Khoản chi'}
            </button>
          ))}
        </div>
        <label>Ngày {direction === 'IN' ? 'nhận' : 'chi'}<input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label>
          {direction === 'IN' ? 'Người thanh toán' : 'Người nhận tiền'}
          <select required value={party} onChange={(e) => setParty(e.target.value)}>
            {/* Khoản cũ nhập tên khác thì vẫn hiện tên đó để không mất khi mở sửa. */}
            {!PARTIES.includes(party) && <option value={party}>{party}</option>}
            {PARTIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <div className="row">
          <label style={{ flex: 1 }}>
            Khoản tiền
            <input required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="vd 5000000" />
          </label>
          <label>
            Tiền tệ
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
        </div>
        <label>Ghi chú (tuỳ chọn)<textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <label>
          Ảnh hoá đơn (tuỳ chọn, tối đa 8 MB)
          <input type="file" accept="image/*" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setRemoveReceipt(false); }} />
        </label>
        {preview && <img className="receipt-preview" src={preview} alt="Hoá đơn" />}
        {payment?.hasReceipt && !file && (
          <label className="check">
            <input type="checkbox" checked={removeReceipt} onChange={(e) => setRemoveReceipt(e.target.checked)} /> Xoá ảnh hoá đơn hiện tại
          </label>
        )}
        {save.error && <div className="notice error">{save.error.message}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose}>Huỷ</button>
          <button className="primary" disabled={save.isPending}>{save.isPending ? 'Đang lưu…' : 'Lưu'}</button>
        </div>
      </form>
    </div>
  );
}

function ReceiptViewer({ payment, onClose }: { payment: Payment; onClose: () => void }) {
  const url = useReceiptUrl(payment.id);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card modal receipt-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Hoá đơn · {payment.party} · {payment.date}</h2>
        {url ? <img className="receipt-full" src={url} alt="Hoá đơn" /> : <div className="center muted">Đang tải ảnh…</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          {url && <a className="button" href={url} download={payment.receiptName ?? 'hoa-don'}>Tải về</a>}
          <button onClick={onClose}>Đóng</button>
        </div>
      </div>
    </div>
  );
}
