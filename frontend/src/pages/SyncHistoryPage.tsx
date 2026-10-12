import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { dateTime } from '../format';
import type { SyncRun } from '../types';

const TRIGGER: Record<SyncRun['trigger'], string> = { INITIAL: 'Lần đầu', MANUAL: 'Thủ công', SCHEDULED: 'Tự động' };

export function SyncHistoryPage() {
  const runs = useQuery({ queryKey: ['sync-history'], queryFn: () => api<SyncRun[]>('/sync/history'), refetchInterval: 10_000 });
  return (
    <>
      <header className="page-header"><h1>Lịch sử đồng bộ</h1></header>
      <div className="card table-card">
        <table>
          <thead>
            <tr><th>Bắt đầu</th><th>Tài khoản</th><th>Kiểu</th><th>Khoảng ngày</th><th>Trạng thái</th><th className="num">Số dòng</th><th>Thời gian</th><th>Lỗi</th></tr>
          </thead>
          <tbody>
            {runs.data?.map((r) => (
              <tr key={r.id}>
                <td>{dateTime(r.startedAt)}</td>
                <td>{r.account?.publisherId}</td>
                <td>{TRIGGER[r.trigger]}</td>
                <td>{r.fromDate} → {r.toDate}</td>
                <td>
                  <span className={`badge ${{ RUNNING: 'info', SUCCESS: 'success', FAILED: 'error' }[r.status]}`}>{r.status}</span>
                </td>
                <td className="num">{r.rowCount}</td>
                <td>{r.finishedAt ? `${Math.round((+new Date(r.finishedAt) - +new Date(r.startedAt)) / 1000)}s` : '—'}</td>
                <td className="error-text small">{r.error}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
