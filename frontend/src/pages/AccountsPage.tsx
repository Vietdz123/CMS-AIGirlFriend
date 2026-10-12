import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api, del } from '../api';
import { useAuth } from '../auth';
import { UpdateButton } from '../components/UpdateButton';
import { dateTime, relative } from '../format';
import type { AdmobAccount, SyncStatus } from '../types';

export function AccountsPage() {
  const { can } = useAuth();
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => api<AdmobAccount[]>('/admob/accounts') });
  const status = useQuery({ queryKey: ['sync-status'], queryFn: () => api<SyncStatus[]>('/sync/status'), staleTime: 0 });
  const statusById = new Map(status.data?.map((s) => [s.id, s]));

  const connect = useMutation({
    mutationFn: () => api<{ url: string }>('/admob/oauth/url'),
    onSuccess: ({ url }) => (window.location.href = url),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/admob/accounts/${id}`),
    onSuccess: () => queryClient.invalidateQueries(),
  });

  return (
    <>
      <header className="page-header">
        <h1>Tài khoản AdMob</h1>
        <div className="row">
          <UpdateButton />
          {can('ADMIN') && (
            <button onClick={() => connect.mutate()} disabled={connect.isPending}>+ Kết nối tài khoản</button>
          )}
        </div>
      </header>
      {params.get('connected') && (
        <div className="notice success">
          Kết nối thành công. Đang tải dữ liệu lịch sử ở nền, quá trình này có thể mất vài phút.
        </div>
      )}
      {params.get('error') && <div className="notice error">Kết nối thất bại: {params.get('error')}</div>}
      {connect.error && <div className="notice error">{connect.error.message}</div>}

      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Publisher ID</th>
              <th>Tiền tệ</th>
              <th>Múi giờ</th>
              <th className="num">Apps</th>
              <th>Đồng bộ gần nhất</th>
              <th>Trạng thái</th>
              {can('ADMIN') && <th />}
            </tr>
          </thead>
          <tbody>
            {accounts.data?.map((a) => {
              const s = statusById.get(a.id);
              return (
                <tr key={a.id}>
                  <td>{a.publisherId}</td>
                  <td>{a.currencyCode}</td>
                  <td>{a.timeZone}</td>
                  <td className="num">{a._count.apps}</td>
                  <td title={dateTime(a.lastSyncedAt)}>{relative(a.lastSyncedAt)}</td>
                  <td>
                    {s?.running ? (
                      <span className="badge info">Đang đồng bộ</span>
                    ) : s?.lastRun?.status === 'FAILED' ? (
                      <span className="badge error" title={s.lastRun.error ?? ''}>Lỗi</span>
                    ) : s?.lastRun ? (
                      <span className="badge success">OK</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  {can('ADMIN') && (
                    <td>
                      <button className="link danger" onClick={() => {
                        if (confirm(`Xoá ${a.publisherId} và toàn bộ dữ liệu doanh thu đã lưu?`)) remove.mutate(a.id);
                      }}>Xoá</button>
                    </td>
                  )}
                </tr>
              );
            })}
            {accounts.data?.length === 0 && (
              <tr><td colSpan={7} className="center muted">Chưa có tài khoản nào được kết nối.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
