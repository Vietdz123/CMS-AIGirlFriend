import { useQuery } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { api, qs } from '../api';
import { DateRangePicker } from '../components/DateRangePicker';
import { dateTime, daysAgo, money, num } from '../format';
import type { CampaignSpendChange, GadsBalance, InvalidClickDay, SpendChange } from '../types';

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
  const totalSpendFirst = done.reduce((s, r) => s + r.first!.spend, 0);
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
                <td><b>Tổng ({done.length} ngày có mốc)</b></td>
                <td className="num" title="Tổng spend mốc 1,5 ngày của các ngày có mốc"><b>{money(totalSpendFirst)}</b></td>
                <td className="num" title="Tổng spend hiện tại của các ngày có mốc"><b>{money(totalSpendFirst + totalSpendDelta)}</b></td>
                <td className="num" title={pctChange(totalSpendFirst, totalSpendFirst + totalSpendDelta)}>
                  <b><Delta v={totalSpendDelta} fmt={money} /></b>
                  {totalSpendFirst > 0 && Math.abs(totalSpendDelta) >= 0.005 && (
                    <span className="small muted"> ({pctChange(totalSpendFirst, totalSpendFirst + totalSpendDelta)})</span>
                  )}
                </td>
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

      <CampaignSpendTable range={range} />
      <BalanceTable />
      <InvalidClicksTable range={range} />
    </>
  );
}

/** Chiến dịch HK: tên kết thúc bằng "HK" (cùng quy tắc với thuế 3%). */
const isHk = (name: string) => name.trim().toUpperCase().endsWith('HK');

/**
 * Biến động chi phí theo chiến dịch: tổng chi phí mốc 1,5 ngày so với hiện tại của từng chiến dịch, để biết chiến dịch
 * nào bị Google trừ (click / hiển thị không hợp lệ). Bấm 1 chiến dịch để xem từng ngày.
 */
function CampaignSpendTable({ range }: { range: { from: string; to: string } }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [view, setView] = useState<'campaign' | 'date'>('date');
  const data = useQuery({
    queryKey: ['campaign-spend-history', range.from, range.to],
    queryFn: () => api<CampaignSpendChange[]>(`/sync/campaign-spend-history?${qs(range)}`),
  });
  const rows = data.data ?? [];
  const first = rows.reduce((s, r) => s + r.first, 0);
  const latest = rows.reduce((s, r) => s + r.latest, 0);

  return (
    <>
      <h2>Biến động chi phí theo chiến dịch</h2>
      <div className="seg">
        <button className={view === 'date' ? 'active' : ''} onClick={() => setView('date')}>Theo ngày</button>
        <button className={view === 'campaign' ? 'active' : ''} onClick={() => setView('campaign')}>Theo chiến dịch</button>
      </div>
      <p className="small muted">
        Chi phí từng chiến dịch lúc ngày đó qua 1,5 ngày so với hiện tại, cộng các ngày trong khoảng đang chọn. Chiến dịch
        bị trừ nhiều nhất ở trên cùng. Bấm vào chiến dịch để xem từng ngày. Số trước 23/11 được dựng lại từ bản sao lưu
        hằng ngày (02:30), từ 23/11 CMS ghi mỗi ngày lúc 12:35.
      </p>
      {view === 'date' && <SpendByDateTable rows={rows} loading={data.isLoading} />}
      {view === 'campaign' && (
      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Chiến dịch</th>
              <th className="num">Spend mốc 1,5 ngày</th>
              <th className="num">Spend hiện tại</th>
              <th className="num">Chênh spend</th>
              <th className="num">% bị trừ</th>
              <th className="num" title="Số ngày bị điều chỉnh / số ngày có mốc">Ngày bị đổi</th>
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 && (
              <tr className="total-row">
                <td><b>Tổng ({rows.length} chiến dịch)</b></td>
                <td className="num"><b>{money(first)}</b></td>
                <td className="num"><b>{money(latest)}</b></td>
                <td className="num"><b><Delta v={latest - first} fmt={money} /></b></td>
                <td className="num"><b>{pctChange(first, latest)}</b></td>
                <td />
              </tr>
            )}
            {rows.map((r) => (
              <Fragment key={r.campaignId}>
                <tr className="clickable" onClick={() => setExpanded(expanded === r.campaignId ? null : r.campaignId)}>
                  <td className={`label-cell ${isHk(r.name) ? 'pos' : ''}`} title={`${r.name}\n${r.campaignId}`}>
                    <span className="muted">{expanded === r.campaignId ? '▾ ' : '▸ '}</span>{r.name}
                  </td>
                  <td className="num">{money(r.first)}</td>
                  <td className="num">{money(r.latest)}</td>
                  <td className="num"><Delta v={r.latest - r.first} fmt={money} /></td>
                  <td className={`num ${r.first && (r.latest - r.first) / r.first <= -0.05 ? 'error-text' : ''}`}>{pctChange(r.first, r.latest)}</td>
                  <td className="num">{r.changedDays}/{r.days}</td>
                </tr>
                {expanded === r.campaignId && (
                  <tr className="detail-row">
                    <td colSpan={6}>
                      <table className="daily-table">
                        <thead>
                          <tr>
                            <th>Ngày</th>
                            <th className="num">Spend mốc 1,5 ngày</th>
                            <th className="num">Spend hiện tại</th>
                            <th className="num">Chênh</th>
                            <th className="num">%</th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.byDate.map((d) => (
                            <tr key={d.date}>
                              <td>{d.date}</td>
                              <td className="num">{money(d.first)}</td>
                              <td className="num">{money(d.latest)}</td>
                              <td className="num"><Delta v={d.latest - d.first} fmt={money} /></td>
                              <td className="num">{Math.abs(d.latest - d.first) >= 0.005 ? pctChange(d.first, d.latest) : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {data.isLoading && <tr><td colSpan={6} className="center muted">Đang tải…</td></tr>}
            {!data.isLoading && !rows.length && (
              <tr><td colSpan={6} className="center muted">Chưa có dữ liệu theo chiến dịch trong khoảng này.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      )}
    </>
  );
}

/**
 * Cùng số liệu nhưng theo ngày chạy: mỗi ngày tổng bị trừ bao nhiêu, bấm vào để xem chiến dịch nào bị trừ (nhiều nhất
 * trước).
 */
function SpendByDateTable({ rows, loading }: { rows: CampaignSpendChange[]; loading: boolean }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const days = new Map<string, { first: number; latest: number; camps: { id: string; name: string; first: number; latest: number }[] }>();
  for (const r of rows) {
    for (const d of r.byDate) {
      const o = days.get(d.date) ?? { first: 0, latest: 0, camps: [] };
      o.first += d.first;
      o.latest += d.latest;
      o.camps.push({ id: r.campaignId, name: r.name, first: d.first, latest: d.latest });
      days.set(d.date, o);
    }
  }
  const list = [...days.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  const first = list.reduce((s, [, o]) => s + o.first, 0);
  const latest = list.reduce((s, [, o]) => s + o.latest, 0);
  const worst = (o: { camps: { first: number; latest: number; name: string }[] }) =>
    [...o.camps].sort((a, b) => (a.latest - a.first) - (b.latest - b.first))[0];

  return (
    <div className="card table-card">
      <table>
        <thead>
          <tr>
            <th>Ngày</th>
            <th className="num">Spend mốc 1,5 ngày</th>
            <th className="num">Spend hiện tại</th>
            <th className="num">Chênh spend</th>
            <th className="num">% bị trừ</th>
            <th className="num" title="Số chiến dịch bị điều chỉnh / số chiến dịch chạy ngày đó">Chiến dịch bị đổi</th>
            <th>Bị trừ nhiều nhất</th>
          </tr>
        </thead>
        <tbody>
          {list.length > 0 && (
            <tr className="total-row">
              <td><b>Tổng ({list.length} ngày)</b></td>
              <td className="num"><b>{money(first)}</b></td>
              <td className="num"><b>{money(latest)}</b></td>
              <td className="num"><b><Delta v={latest - first} fmt={money} /></b></td>
              <td className="num"><b>{pctChange(first, latest)}</b></td>
              <td colSpan={2} />
            </tr>
          )}
          {list.map(([date, o]) => {
            const w = worst(o);
            const changed = o.camps.filter((c) => Math.abs(c.latest - c.first) >= 0.005).length;
            return (
              <Fragment key={date}>
                <tr className="clickable" onClick={() => setExpanded(expanded === date ? null : date)}>
                  <td><span className="muted">{expanded === date ? '▾ ' : '▸ '}</span>{date}</td>
                  <td className="num">{money(o.first)}</td>
                  <td className="num">{money(o.latest)}</td>
                  <td className="num"><Delta v={o.latest - o.first} fmt={money} /></td>
                  <td className={`num ${o.first && (o.latest - o.first) / o.first <= -0.05 ? 'error-text' : ''}`}>
                    {Math.abs(o.latest - o.first) >= 0.005 ? pctChange(o.first, o.latest) : '—'}
                  </td>
                  <td className="num">{changed}/{o.camps.length}</td>
                  <td className="small">
                    {w && w.latest - w.first <= -0.005
                      ? <><span className={isHk(w.name) ? 'success-text' : ''}>{w.name}</span> <span className="error-text">−{money(w.first - w.latest)}</span></>
                      : <span className="muted">—</span>}
                  </td>
                </tr>
                {expanded === date && (
                  <tr className="detail-row">
                    <td colSpan={7}>
                      <table className="daily-table">
                        <thead>
                          <tr>
                            <th>Chiến dịch ({date})</th>
                            <th className="num">Spend mốc 1,5 ngày</th>
                            <th className="num">Spend hiện tại</th>
                            <th className="num">Chênh</th>
                            <th className="num">%</th>
                            <th className="num" title="Phần của chiến dịch trong tổng số bị trừ của ngày">Tỷ trọng bị trừ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...o.camps].sort((a, b) => (a.latest - a.first) - (b.latest - b.first)).map((c) => (
                            <tr key={c.id}>
                              <td className={`label-cell ${isHk(c.name) ? 'pos' : ''}`} title={c.id}>{c.name}</td>
                              <td className="num">{money(c.first)}</td>
                              <td className="num">{money(c.latest)}</td>
                              <td className="num"><Delta v={c.latest - c.first} fmt={money} /></td>
                              <td className="num">{Math.abs(c.latest - c.first) >= 0.005 ? pctChange(c.first, c.latest) : '—'}</td>
                              <td className="num">
                                {o.latest - o.first < -0.005 && c.latest - c.first < -0.005
                                  ? `${Math.round((100 * (c.latest - c.first)) / (o.latest - o.first))}%` : '—'}
                              </td>
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
          {loading && <tr><td colSpan={7} className="center muted">Đang tải…</td></tr>}
          {!loading && !list.length && <tr><td colSpan={7} className="center muted">Chưa có dữ liệu theo chiến dịch trong khoảng này.</td></tr>}
        </tbody>
      </table>
    </div>
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
