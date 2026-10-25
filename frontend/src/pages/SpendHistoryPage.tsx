import { useQuery } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { api, qs } from '../api';
import { DateRangePicker } from '../components/DateRangePicker';
import { dateTime, daysAgo, money, num } from '../format';
import type { GadsBalance, InvalidClickDay, SpendChange } from '../types';

/** Chênh lệch có dấu, tô xanh khi tăng, đỏ khi giảm; "—" khi không đổi. */
function Delta({ v, fmt }: { v: number; fmt: (v: number) => string }) {
  if (Math.abs(v) < 0.005) return <span className="muted">—</span>;
  return <span className={v > 0 ? 'success-text' : 'error-text'}>{v > 0 ? '+' : '−'}{fmt(Math.abs(v))}</span>;
}

/** Tỷ lệ click không hợp lệ trên ngưỡng này thì tô đỏ (thường dưới khoảng 5%). */
const HIGH_INVALID = 0.05;
const invalidRate = (invalid: number, clicks: number) => (clicks ? `${((invalid / clicks) * 100).toFixed(1)}%` : '—');

const pctChange = (from: number, to: number) => (from ? `${(((to - from) / from) * 100).toFixed(1)}%` : '');

/**
 * Biến động chi phí Google Ads: Google còn điều chỉnh chi phí và conversion value của ngày cũ sau khi đã báo. Mỗi lần
 * ngày CMS ghi lại số của các ngày cũ nếu có thay đổi; trang này so số lúc ngày đã qua 1,5 ngày với số hiện tại.
 */
export function SpendHistoryPage() {
  const [range, setRange] = useState({ from: daysAgo(30), to: daysAgo(0) });
  const [onlyChanged, setOnlyChanged] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const data = useQuery({
    queryKey: ['spend-history', range.from, range.to],
    queryFn: () => api<SpendChange[]>(`/sync/spend-history?${qs(range)}`),
  });
  const all = data.data ?? [];
  // Chỉ so được các ngày đã có mốc gốc (đã qua 1,5 ngày); trước đó số còn về thêm.
  const done = all.filter((r) => r.first);
  const changed = (r: SpendChange) =>
    !!r.first && (r.first.spend !== r.latest.spend || r.first.convValue !== r.latest.convValue || r.first.installs !== r.latest.installs);
  const rows = onlyChanged ? all.filter(changed) : all;
  const totalSpendDelta = done.reduce((s, r) => s + r.latest.spend - r.first!.spend, 0);
  const totalValueDelta = done.reduce((s, r) => s + r.latest.convValue - r.first!.convValue, 0);
  const since = all.length ? all.map((r) => r.versions[0].at).sort()[0] : null;

  return (
    <>
      <header className="page-header"><h1>Biến động chi phí Google Ads</h1></header>
      <p className="small muted">
        Google Ads vẫn điều chỉnh chi phí, installs và conversion value của ngày cũ (trừ click không hợp lệ, chuyển đổi
        về trễ…). Mỗi ngày lúc 12:35, CMS ghi lại số của các ngày cũ nếu có thay đổi. "Mốc 1,5 ngày" là số khi ngày đó
        đã qua 1,5 ngày (12:00 trưa hôm sau, số đã gần đủ), "Hiện tại" là số mới nhất. Lần ghi sớm hơn (in nghiêng)
        chỉ xem khi bấm vào ngày. Bắt đầu ghi từ {since ? dateTime(since) : 'lần đồng bộ tới'}; trước 24/10 chỉ
        có vài mốc lấy từ bản sao lưu.
      </p>
      <div className="filters">
        <DateRangePicker from={range.from} to={range.to} onChange={setRange} />
        <label className="inline">
          <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} /> Chỉ ngày đã bị điều chỉnh
        </label>
      </div>

      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Ngày</th>
              <th className="num">Spend mốc 1,5 ngày</th>
              <th className="num">Spend hiện tại</th>
              <th className="num">Chênh spend</th>
              <th className="num">Conv. value mốc 1,5 ngày</th>
              <th className="num">Conv. value hiện tại</th>
              <th className="num">Chênh value</th>
              <th className="num" title="Installs mốc 1,5 ngày → hiện tại">Installs</th>
              <th className="num">ROAS mốc 1,5 ngày → hiện tại</th>
              <th className="num">Số lần đổi</th>
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 && (
              <tr className="total-row">
                <td colSpan={3}><b>Tổng chênh lệch ({done.length} ngày có mốc)</b></td>
                <td className="num"><b><Delta v={totalSpendDelta} fmt={money} /></b></td>
                <td colSpan={2} />
                <td className="num"><b><Delta v={totalValueDelta} fmt={money} /></b></td>
                <td colSpan={3} />
              </tr>
            )}
            {rows.map((r) => {
              const k = r.date;
              const roas = (x: { spend: number; convValue: number }) => (x.spend ? (x.convValue / x.spend).toFixed(2) : '—');
              const f = r.first;
              return (
                <Fragment key={k}>
                  <tr className="clickable" onClick={() => setExpanded(expanded === k ? null : k)}>
                    <td>
                      <span className="muted">{expanded === k ? '▾ ' : '▸ '}</span>{r.date}
                      {!f && <span className="small muted"> (chưa đủ 1,5 ngày)</span>}
                    </td>
                    <td className="num">{f ? money(f.spend) : '—'}</td>
                    <td className="num">{money(r.latest.spend)}</td>
                    <td className="num" title={f ? pctChange(f.spend, r.latest.spend) : undefined}>
                      {f ? <Delta v={r.latest.spend - f.spend} fmt={money} /> : '—'}
                    </td>
                    <td className="num">{f ? money(f.convValue) : '—'}</td>
                    <td className="num">{money(r.latest.convValue)}</td>
                    <td className="num" title={f ? pctChange(f.convValue, r.latest.convValue) : undefined}>
                      {f ? <Delta v={r.latest.convValue - f.convValue} fmt={money} /> : '—'}
                    </td>
                    <td className="num">
                      {f ? num(f.installs) : '—'}{f && f.installs !== r.latest.installs && <> → {num(r.latest.installs)}</>}
                    </td>
                    <td className="num">{f ? `${roas(f)} → ${roas(r.latest)}` : roas(r.latest)}</td>
                    <td className="num">{r.versions.filter((v) => !v.early).length > 1 ? r.versions.filter((v) => !v.early).length - 1 : '—'}</td>
                  </tr>
                  {expanded === k && (
                    <tr className="detail-row">
                      <td colSpan={10}>
                        <table>
                          <thead>
                            <tr>
                              <th>Ghi nhận lúc</th>
                              <th className="num">Spend</th>
                              <th className="num">Conv. value</th>
                              <th className="num">Installs</th>
                              <th className="num">ROAS</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.versions.map((v, i) => (
                              <tr key={i} className={v.early ? 'roas-partial' : undefined}>
                                <td>{dateTime(v.at)}{v.early && <span className="small muted"> · chưa đủ 1,5 ngày</span>}</td>
                                <td className="num">{money(v.spend)}</td>
                                <td className="num">{money(v.convValue)}</td>
                                <td className="num">{num(v.installs)}</td>
                                <td className="num">{roas(v)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {data.isLoading && <tr><td colSpan={10} className="center muted">Đang tải…</td></tr>}
            {!data.isLoading && !rows.length && (
              <tr><td colSpan={10} className="center muted">
                {all.length ? 'Chưa có ngày nào bị điều chỉnh trong khoảng này.' : 'Chưa có dữ liệu. CMS ghi lịch sử mỗi ngày lúc 12:35.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <BalanceTable />
      <InvalidClicksTable range={range} />
    </>
  );
}

/** Tiền theo đơn vị gốc của tài khoản (VND không có số lẻ). */
const localMoney = (v: number, currency: string) =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency, maximumFractionDigits: currency === 'VND' ? 0 : 2 }).format(v);

/**
 * Số dư tài khoản Google Ads, dạng gọn: số dư còn lại, tổng Google đã cộng / hoàn từ khi mở tài khoản, và các lần
 * được cộng tiền CMS bắt được (tổng điều chỉnh tăng giữa 2 lần ghi). CMS ghi mỗi ngày lúc 12:35 và khi mở trang.
 */
function BalanceTable() {
  const data = useQuery({ queryKey: ['gads-balance'], queryFn: () => api<GadsBalance[]>('/sync/gads-balance') });
  const accounts = data.data ?? [];

  return (
    <>
      <h2>Số dư tài khoản</h2>
      {accounts.map((a) => {
        const c = a.current;
        const m = (v: number) => localMoney(v, a.currency);
        // Mỗi lần tổng điều chỉnh đổi giữa 2 lần ghi = 1 lần Google cộng (hoàn) hoặc trừ tiền.
        const refunds = a.history
          .map((h, i) => (i ? { at: h.at, amount: h.adjustment - a.history[i - 1].adjustment } : null))
          .filter((x): x is { at: string; amount: number } => !!x && x.amount !== 0)
          .reverse();
        const since = a.history[0]?.at;
        return (
          <div key={a.id} className="card table-card">
            <table>
              <tbody>
                <tr className="total-row highlight">
                  <td>Số dư còn lại <span className="small muted">· {a.name}</span></td>
                  <td className="num col-total"><b>{c ? m(c.limit - c.served) : '—'}</b></td>
                </tr>
                <tr>
                  <td>Google đã hoàn / cộng từ khi mở tài khoản</td>
                  <td className="num">{c ? m(c.adjustment) : '—'}</td>
                </tr>
                <tr>
                  <td colSpan={2}><b>Các lần được hoàn tiền</b>{since && <span className="small muted"> (từ {dateTime(since)})</span>}</td>
                </tr>
                {refunds.map((r) => (
                  <tr key={r.at}>
                    <td>{dateTime(r.at)}</td>
                    <td className="num"><Delta v={r.amount} fmt={m} /></td>
                  </tr>
                ))}
                {!refunds.length && (
                  <tr><td colSpan={2} className="muted">Chưa có lần nào. Lần Google hoàn tiền tiếp theo sẽ hiện ở đây.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        );
      })}
      <p className="small muted">
        Các lần hoàn trước khi CMS bắt đầu ghi chỉ xem được trong Google Ads → Thanh toán → Giao dịch.
      </p>
      {data.isLoading && <div className="card center muted">Đang tải…</div>}
      {data.isError && <div className="card center error-text">{(data.error as Error).message}</div>}
    </>
  );
}

/**
 * Click không hợp lệ theo ngày: click Google đã lọc ra, không tính tiền; nếu đã tính thì Google hoàn lại thành tín
 * dụng trong tài khoản. Lấy thẳng từ Google Ads (giữ 1 giờ).
 */
function InvalidClicksTable({ range }: { range: { from: string; to: string } }) {
  const data = useQuery({
    queryKey: ['invalid-clicks', range.from, range.to],
    queryFn: () => api<InvalidClickDay[]>(`/sync/invalid-clicks?${qs(range)}`),
  });
  const rows = data.data ?? [];
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  const invalid = rows.reduce((s, r) => s + r.invalidClicks, 0);
  const rateCell = (inv: number, total: number) => (
    <td className={`num ${total && inv / total > HIGH_INVALID ? 'error-text' : ''}`}>{invalidRate(inv, total)}</td>
  );

  return (
    <>
      <h2>Click không hợp lệ</h2>
      <p className="small muted">
        Click Google đã lọc là không hợp lệ: không tính tiền, nếu đã tính thì Google hoàn lại thành tín dụng trong tài
        khoản (Google Ads → Thanh toán → Giao dịch, dòng "Invalid activity"). Tỷ lệ trên {HIGH_INVALID * 100}% tô đỏ.
        Lấy trực tiếp từ Google Ads, cập nhật mỗi giờ.
      </p>
      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Ngày</th>
              <th className="num">Click</th>
              <th className="num">Click không hợp lệ</th>
              <th className="num">Tỷ lệ</th>
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 && (
              <tr className="total-row">
                <td><b>Tổng ({rows.length} ngày)</b></td>
                <td className="num"><b>{num(clicks)}</b></td>
                <td className="num"><b>{num(invalid)}</b></td>
                {rateCell(invalid, clicks)}
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.date}>
                <td>{r.date}</td>
                <td className="num">{num(r.clicks)}</td>
                <td className="num">{num(r.invalidClicks)}</td>
                {rateCell(r.invalidClicks, r.clicks)}
              </tr>
            ))}
            {data.isLoading && <tr><td colSpan={4} className="center muted">Đang tải…</td></tr>}
            {data.isError && <tr><td colSpan={4} className="center error-text">{(data.error as Error).message}</td></tr>}
            {!data.isLoading && !data.isError && !rows.length && (
              <tr><td colSpan={4} className="center muted">Không có click nào trong khoảng này.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
