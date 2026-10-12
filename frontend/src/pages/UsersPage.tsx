import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { api, del, patch, post, put } from '../api';
import { useAuth } from '../auth';
import type { AppInfo, Role, UserRow } from '../types';

const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Admin — toàn quyền',
  MANAGER: 'Manager — xem app được gán, được bấm Update',
  VIEWER: 'Viewer — chỉ xem app được gán',
};

export function UsersPage() {
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<UserRow[]>('/users') });
  const apps = useQuery({ queryKey: ['apps'], queryFn: () => api<AppInfo[]>('/admob/apps') });
  const [editing, setEditing] = useState<UserRow | 'new' | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['users'] });

  const toggle = useMutation({
    mutationFn: (u: UserRow) => patch(`/users/${u.id}`, { active: !u.active }),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: (id: string) => del(`/users/${id}`), onSuccess: refresh });

  return (
    <>
      <header className="page-header">
        <h1>Người dùng</h1>
        <button className="primary" onClick={() => setEditing('new')}>+ Thêm người dùng</button>
      </header>
      <div className="card table-card">
        <table>
          <thead>
            <tr><th>Tên</th><th>Email</th><th>Quyền</th><th>App được xem</th><th>Trạng thái</th><th /></tr>
          </thead>
          <tbody>
            {users.data?.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>{u.role}</td>
                <td className="small">
                  {u.role === 'ADMIN' ? 'Tất cả' : u.appIds.length
                    ? u.appIds.map((id) => apps.data?.find((a) => a.id === id)?.name ?? id).join(', ')
                    : <span className="muted">Chưa gán</span>}
                </td>
                <td>{u.active ? <span className="badge success">Hoạt động</span> : <span className="badge">Đã khoá</span>}</td>
                <td className="row">
                  <button className="link" onClick={() => setEditing(u)}>Sửa</button>
                  {u.id !== me!.id && (
                    <>
                      <button className="link" onClick={() => toggle.mutate(u)}>{u.active ? 'Khoá' : 'Mở khoá'}</button>
                      <button className="link danger" onClick={() => confirm(`Xoá ${u.email}?`) && remove.mutate(u.id)}>Xoá</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <UserDialog user={editing === 'new' ? null : editing} apps={apps.data ?? []} isSelf={editing !== 'new' && editing.id === me!.id}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />
      )}
    </>
  );
}

function UserDialog({ user, apps, isSelf, onClose, onSaved }: {
  user: UserRow | null;
  apps: AppInfo[];
  isSelf: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>(user?.role ?? 'VIEWER');
  const [appIds, setAppIds] = useState<string[]>(user?.appIds ?? []);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      if (user) {
        await patch(`/users/${user.id}`, { name, role, ...(password ? { password } : {}) });
        await put(`/users/${user.id}/apps`, { appIds });
      } else {
        await post('/users', { name, email, password, role, appIds });
      }
    },
    onSuccess: onSaved,
    onError: (e: Error) => setError(e.message),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="card modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{user ? 'Sửa người dùng' : 'Thêm người dùng'}</h2>
        <label>Tên<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={!!user} /></label>
        <label>
          {user ? 'Mật khẩu mới (để trống nếu không đổi)' : 'Mật khẩu'}
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required={!user} />
        </label>
        <label>
          Quyền
          <select value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={isSelf}>
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </label>
        {role !== 'ADMIN' && (
          <fieldset>
            <legend>App được xem</legend>
            <div className="checklist">
              {apps.map((a) => (
                <label key={a.id} className="check">
                  <input type="checkbox" checked={appIds.includes(a.id)}
                    onChange={(e) => setAppIds(e.target.checked ? [...appIds, a.id] : appIds.filter((id) => id !== a.id))} />
                  {a.name} <span className="muted small">{a.storeId}</span>
                </label>
              ))}
              {!apps.length && <span className="muted small">Chưa có app nào</span>}
            </div>
          </fieldset>
        )}
        {error && <div className="error-text">{error}</div>}
        <div className="row end">
          <button type="button" onClick={onClose}>Huỷ</button>
          <button className="primary" disabled={save.isPending}>Lưu</button>
        </div>
      </form>
    </div>
  );
}
