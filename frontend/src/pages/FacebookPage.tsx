import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { api, del, patch, post } from '../api';
import { useAuth } from '../auth';
import { dateTime, money, relative } from '../format';
import type { AppInfo, FbAdAccount, FbApiAdAccount, FbCampaign } from '../types';

export function FacebookPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [connecting, setConnecting] = useState(false);

  const accounts = useQuery({
    queryKey: ['fb-accounts'],
    queryFn: () => api<FbAdAccount[]>('/facebook/accounts'),
    refetchInterval: (q) => (q.state.data?.some((a) => a.running) ? 2000 : false),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/facebook/accounts/${id}`),
    onSuccess: () => queryClient.invalidateQueries(),
  });
  const sync = useMutation({
    mutationFn: () => post('/facebook/sync', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['fb-accounts'] }),
  });
  const running = accounts.data?.some((a) => a.running) ?? false;

  return (
    <>
      <header className="page-header">
        <h1>Facebook Ads</h1>
        <div className="row">
          {can('ADMIN', 'MANAGER') && !!accounts.data?.length && (
            <button disabled={running || sync.isPending} onClick={() => sync.mutate()}>
              {running ? <span className="spinner" /> : '⟳'} {running ? 'Đang cập nhật' : 'Update chi phí'}
            </button>
          )}
          {can('ADMIN') && <button className="primary" onClick={() => setConnecting(true)}>+ Kết nối tài khoản</button>}
        </div>
      </header>
      {sync.error && <div className="notice error">{sync.error.message}</div>}

      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Tài khoản quảng cáo</th>
              <th>ID</th>
              <th>Tiền tệ</th>
              <th>Múi giờ</th>
              <th className="num">Chiến dịch</th>
              <th>Đồng bộ gần nhất</th>
              <th>Trạng thái</th>
              {can('ADMIN') && <th />}
            </tr>
          </thead>
          <tbody>
            {accounts.data?.map((a) => (
              <tr key={a.id}>
                <td>{a.name}</td>
                <td className="muted">{a.id}</td>
                <td>
                  {a.currencyCode}
                  {a.currencyCode !== 'USD' && (
                    <span className="badge error" title="CMS cộng thẳng chi phí với doanh thu USD, chưa quy đổi tỷ giá">
                      {' '}chưa quy đổi
                    </span>
                  )}
                </td>
                <td>{a.timeZone}</td>
                <td className="num">{a._count.campaigns}</td>
                <td title={dateTime(a.lastSyncedAt)}>{relative(a.lastSyncedAt)}</td>
                <td>
                  {a.running ? <span className="badge info">Đang đồng bộ</span>
                    : a.lastError ? <span className="badge error" title={a.lastError}>Lỗi</span>
                    : a.lastSyncedAt ? <span className="badge success">OK</span>
                    : <span className="muted">—</span>}
                </td>
                {can('ADMIN') && (
                  <td>
                    <button className="link danger" onClick={() => {
                      if (confirm(`Xoá ${a.name} và toàn bộ chi phí đã lưu?`)) remove.mutate(a.id);
                    }}>Xoá</button>
                  </td>
                )}
              </tr>
            ))}
            {accounts.data?.length === 0 && (
              <tr><td colSpan={8} className="center muted">Chưa kết nối tài khoản Facebook Ads nào.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {accounts.data?.some((a) => a.lastError) && (
        <p className="small error-text">
          {accounts.data.filter((a) => a.lastError).map((a) => `${a.name}: ${a.lastError}`).join(' · ')}
        </p>
      )}

      {can('ADMIN') && !!accounts.data?.length && <Campaigns />}
      {connecting && <ConnectModal onClose={() => setConnecting(false)} />}
    </>
  );
}

/** Ghép chiến dịch với app AdMob: tự động theo package name, hoặc chọn tay. */
function Campaigns() {
  const queryClient = useQueryClient();
  const campaigns = useQuery({ queryKey: ['fb-campaigns'], queryFn: () => api<FbCampaign[]>('/facebook/campaigns') });
  const apps = useQuery({ queryKey: ['apps'], queryFn: () => api<AppInfo[]>('/admob/apps') });
  const appName = (id: string | null) => (id ? apps.data?.find((a) => a.id === id)?.name ?? id : null);
  const setApp = useMutation({
    mutationFn: ({ id, appId }: { id: string; appId: string }) => patch(`/facebook/campaigns/${id}`, { appId }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
  const rows = [...(campaigns.data ?? [])].sort((a, b) => b.totalSpend - a.totalSpend);

  return (
    <>
      <h2>Chiến dịch → App</h2>
      <p className="small muted">
        Chiến dịch quảng bá app được ghép tự động theo package name. Chiến dịch không ghép được thì chọn app bằng tay,
        nếu không chi phí sẽ nằm ở dòng "Chưa ghép app".
      </p>
      <div className="card table-card">
        <table>
          <thead>
            <tr><th>Chiến dịch</th><th>Package</th><th className="num">Tổng chi phí</th><th>App</th></tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td className="label-cell" title={c.id}>{c.name}</td>
                <td className="muted">{c.storeId ?? '—'}</td>
                <td className="num">{money(c.totalSpend)}</td>
                <td>
                  <select value={c.appId ?? ''} onChange={(e) => setApp.mutate({ id: c.id, appId: e.target.value })}>
                    <option value="">
                      {c.autoAppId ? `Tự động: ${appName(c.autoAppId)}` : 'Chưa ghép app'}
                    </option>
                    {apps.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={4} className="center muted">Chưa có chiến dịch nào. Đợi đồng bộ xong rồi tải lại trang.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ConnectModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState('');
  const [selected, setSelected] = useState<string[]>([]);

  const check = useMutation({
    mutationFn: () => post<FbApiAdAccount[]>('/facebook/token/check', { token }),
    onSuccess: (list) => setSelected(list.map((a) => a.id)),
  });
  const connect = useMutation({
    mutationFn: () => post('/facebook/accounts', { token, accountIds: selected }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fb-accounts'] });
      onClose();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!check.data) check.mutate();
    else connect.mutate();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="card modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>Kết nối Facebook Ads</h2>
        <label>
          Token System User (quyền ads_read)
          <input type="password" value={token} autoComplete="off" required
            onChange={(e) => { setToken(e.target.value); check.reset(); }} />
        </label>
        <p className="small muted">Token được mã hoá trước khi lưu vào database và không hiển thị lại.</p>

        {check.data && (
          <fieldset>
            <legend>Chọn tài khoản quảng cáo</legend>
            <div className="checklist">
              {check.data.map((a) => (
                <label key={a.id} className="check">
                  <input type="checkbox" checked={selected.includes(a.id)}
                    onChange={(e) => setSelected(e.target.checked ? [...selected, a.id] : selected.filter((x) => x !== a.id))} />
                  {a.name} <span className="muted small">{a.account_id} · {a.currency} · {a.timezone_name}</span>
                </label>
              ))}
              {check.data.length === 0 && (
                <span className="muted">Token không xem được tài khoản quảng cáo nào. Hãy gán tài khoản cho System User.</span>
              )}
            </div>
          </fieldset>
        )}
        {(check.error || connect.error) && <div className="notice error">{(check.error ?? connect.error)!.message}</div>}

        <div className="row end">
          <button type="button" onClick={onClose}>Huỷ</button>
          {!check.data ? (
            <button className="primary" disabled={!token || check.isPending}>Kiểm tra token</button>
          ) : (
            <button className="primary" disabled={!selected.length || connect.isPending}>Kết nối</button>
          )}
        </div>
      </form>
    </div>
  );
}
