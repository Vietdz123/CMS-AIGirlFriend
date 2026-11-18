import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, del, post } from '../api';
import { useAuth } from '../auth';
import { CampaignTable } from '../components/CampaignTable';
import { CohortRoasTable } from '../components/CohortRoasTable';
import { HourlyRoasTable } from '../components/HourlyRoasTable';
import { dateTime, relative } from '../format';
import type { GadsAccount } from '../types';

const formatCustomerId = (id: string) => id.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3');

export function GoogleAdsPage() {
  const { can } = useAuth();
  const [params] = useSearchParams();
  const queryClient = useQueryClient();

  const accounts = useQuery({
    queryKey: ['gads-accounts'],
    queryFn: () => api<GadsAccount[]>('/google-ads/accounts'),
    refetchInterval: (q) => (q.state.data?.some((a) => a.running) ? 2000 : false),
  });
  const connect = useMutation({
    mutationFn: () => api<{ url: string }>('/google-ads/oauth/url'),
    onSuccess: ({ url }) => (window.location.href = url),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/google-ads/accounts/${id}`),
    onSuccess: () => queryClient.invalidateQueries(),
  });
  const sync = useMutation({
    mutationFn: (full: boolean = false) => post('/google-ads/sync', { full }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['gads-accounts'] }),
  });
  const running = accounts.data?.some((a) => a.running) ?? false;
  // Link mời người khác tự nối tài khoản Google Ads của họ (vd email ở HK không thể đăng nhập ở đây).
  const [invite, setInvite] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const createInvite = useMutation({
    mutationFn: () => post<{ url: string; expiresAt: string }>('/google-ads/invite'),
    onSuccess: (v) => {
      setInvite(v);
      setCopied(false);
    },
  });

  return (
    <>
      <header className="page-header">
        <h1>Google Ads</h1>
        <div className="row">
          {can('ADMIN', 'MANAGER') && !!accounts.data?.length && (
            <button disabled={running || sync.isPending} onClick={() => sync.mutate(false)}>
              {running ? <span className="spinner" /> : '⟳'} {running ? 'Đang cập nhật' : 'Update chi phí'}
            </button>
          )}
          {can('ADMIN') && !!accounts.data?.length && (
            <button disabled={running || sync.isPending} title="Tải lại toàn bộ 90 ngày gần nhất từ Google Ads"
              onClick={() => confirm('Tải lại toàn bộ 90 ngày chi phí, installs và conversion value từ Google Ads?') && sync.mutate(true)}>
              Tải lại 90 ngày
            </button>
          )}
          {can('ADMIN') && (
            <button onClick={() => createInvite.mutate()} disabled={createInvite.isPending}
              title="Tạo link gửi cho người khác tự đăng nhập email Google của họ và nối tài khoản Google Ads">
              Tạo link mời
            </button>
          )}
          {can('ADMIN') && (
            <button className="primary" onClick={() => connect.mutate()} disabled={connect.isPending}>
              + Kết nối Google Ads
            </button>
          )}
        </div>
      </header>
      {invite && (
        <div className="notice info invite-box">
          <div>
            Gửi link này cho chủ email Google Ads. Họ mở link, đăng nhập Google và đồng ý là tài khoản quảng cáo của họ tự
            hiện ở bảng dưới (không cần tài khoản CMS). Hết hạn {dateTime(invite.expiresAt)}.
          </div>
          <div className="invite-row">
            <input readOnly value={invite.url} onFocus={(e) => e.target.select()} />
            <button onClick={() => navigator.clipboard.writeText(invite.url).then(() => setCopied(true))}>
              {copied ? 'Đã copy' : 'Copy'}
            </button>
            <button className="link" onClick={() => setInvite(null)}>Đóng</button>
          </div>
        </div>
      )}
      {createInvite.error && <div className="notice error">{createInvite.error.message}</div>}
      {params.get('connected') && (
        <div className="notice success">
          Kết nối thành công. Đang tải chi phí lịch sử ở nền, quá trình này có thể mất vài phút.
        </div>
      )}
      {params.get('error') && <div className="notice error">Kết nối thất bại: {params.get('error')}</div>}
      {(connect.error || sync.error) && <div className="notice error">{(connect.error ?? sync.error)!.message}</div>}

      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Tài khoản quảng cáo</th>
              <th>Customer ID</th>
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
                <td className="muted">{formatCustomerId(a.id)}</td>
                <td>
                  {a.currencyCode}
                  {a.currencyCode !== 'USD' && <span className="muted small"> → USD</span>}
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
              <tr><td colSpan={8} className="center muted">Chưa kết nối tài khoản Google Ads nào.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {accounts.data?.some((a) => a.lastError) && (
        <p className="small error-text">
          {accounts.data.filter((a) => a.lastError).map((a) => `${a.name}: ${a.lastError}`).join(' · ')}
        </p>
      )}

      {!!accounts.data?.length && <HourlyRoasTable />}
      {!!accounts.data?.length && <CohortRoasTable />}
      {!!accounts.data?.length && (
        <CampaignTable apiBase="/google-ads" withRoas />
      )}
    </>
  );
}

