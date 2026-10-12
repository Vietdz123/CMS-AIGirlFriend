import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api, post } from '../api';
import { useAuth } from '../auth';
import { relative } from '../format';
import type { SyncStatus } from '../types';

/**
 * Nút "Update": gọi AdMob API để lấy số liệu mới nhất. Trong lúc sync chạy, poll trạng thái
 * mỗi 2s; khi xong thì invalidate mọi query report để dashboard tự cập nhật.
 */
export function UpdateButton() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const wasRunning = useRef(false);

  const status = useQuery({
    queryKey: ['sync-status'],
    queryFn: () => api<SyncStatus[]>('/sync/status'),
    refetchInterval: (q) => (q.state.data?.some((s) => s.running) ? 2000 : 60_000),
    staleTime: 0,
  });

  const running = status.data?.some((s) => s.running) ?? false;
  const lastSynced = status.data
    ?.map((s) => s.lastSyncedAt)
    .filter((d): d is string => !!d)
    .sort()
    .at(0); // tài khoản cũ nhất = độ tươi của toàn bộ dữ liệu
  const failed = status.data?.filter((s) => !s.running && s.lastRun?.status === 'FAILED') ?? [];

  useEffect(() => {
    if (wasRunning.current && !running) {
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['apps'] });
    }
    wasRunning.current = running;
  }, [running, queryClient]);

  const trigger = useMutation({
    mutationFn: () => post('/sync', {}),
    onMutate: () => setError(null),
    onSuccess: () => {
      wasRunning.current = true;
      queryClient.invalidateQueries({ queryKey: ['sync-status'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  if (!status.data?.length) return null;

  return (
    <div className="update-box">
      <div className="small muted">
        {running ? 'Đang lấy dữ liệu từ AdMob…' : `Cập nhật lần cuối: ${relative(lastSynced ?? null)}`}
        {failed.length > 0 && !running && (
          <span className="error-text" title={failed.map((f) => `${f.publisherId}: ${f.lastRun?.error}`).join('\n')}>
            {' '}· {failed.length} tài khoản lỗi
          </span>
        )}
        {error && <span className="error-text"> · {error}</span>}
      </div>
      {can('ADMIN', 'MANAGER') && (
        <button className="primary" disabled={running || trigger.isPending} onClick={() => trigger.mutate()}>
          {running ? <span className="spinner" /> : '⟳'} {running ? 'Đang cập nhật' : 'Update'}
        </button>
      )}
    </div>
  );
}
