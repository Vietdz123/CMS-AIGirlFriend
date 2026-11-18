import { useMutation } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../api';

/**
 * Trang công khai của link mời: người nhận (không có tài khoản CMS) đăng nhập Google để cho CMS đọc chi phí Google Ads
 * của họ. CMS chỉ xin quyền Google Ads, không thấy email / dữ liệu khác của họ.
 */
export function ConnectGoogleAdsPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const connected = params.get('connected');
  const error = params.get('error');
  const start = useMutation({
    mutationFn: () => api<{ url: string }>(`/google-ads/invite/oauth-url?${qs({ token: token ?? '' })}`),
    onSuccess: ({ url }) => (window.location.href = url),
  });

  return (
    <div className="connect-page">
      <div className="card connect-card">
        <h1>Kết nối Google Ads</h1>
        {connected ? (
          <>
            <div className="notice success">
              Kết nối thành công {Number(connected) > 1 ? `${connected} tài khoản quảng cáo` : 'tài khoản quảng cáo'}. Bạn có thể đóng trang này.
            </div>
            <p className="small muted">
              Muốn ngừng chia sẻ, vào myaccount.google.com → Bảo mật → Ứng dụng bên thứ ba có quyền truy cập, rồi gỡ quyền
              của ứng dụng này.
            </p>
          </>
        ) : !token ? (
          <div className="notice error">{error ? `Kết nối thất bại: ${error}` : 'Link mời không đúng. Hãy xin link mới từ người gửi.'}</div>
        ) : (
          <>
            <p>
              Bạn được mời chia sẻ <b>số liệu chi phí Google Ads</b> (chi phí, lượt cài, conversion value theo chiến dịch)
              với hệ thống báo cáo. Bấm nút bên dưới, đăng nhập đúng email Google đang quản lý tài khoản Google Ads và
              đồng ý quyền truy cập.
            </p>
            <ul className="small muted">
              <li>Chỉ dùng để đọc báo cáo; hệ thống không sửa chiến dịch hay thanh toán.</li>
              <li>Link có hạn dùng; hết hạn thì xin link mới.</li>
            </ul>
            {error && <div className="notice error">Kết nối thất bại: {error}</div>}
            {start.error && <div className="notice error">{start.error.message}</div>}
            <button className="primary" disabled={start.isPending} onClick={() => start.mutate()}>
              {start.isPending ? 'Đang chuyển…' : 'Đăng nhập Google để kết nối'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
