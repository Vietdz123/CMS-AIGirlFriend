import type { ReactElement } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { AccountsPage } from './pages/AccountsPage';
import { AppsPage } from './pages/AppsPage';
import { BreakdownPage } from './pages/BreakdownPage';
import { DashboardPage } from './pages/DashboardPage';
import { FacebookPage } from './pages/FacebookPage';
import { GoogleAdsPage } from './pages/GoogleAdsPage';
import { LoginPage } from './pages/LoginPage';
import { MonetPage } from './pages/MonetPage';
import { SyncHistoryPage } from './pages/SyncHistoryPage';
import { UsersPage } from './pages/UsersPage';

export function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="center muted">Đang tải…</div>;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route element={user ? <Layout /> : <Navigate to="/login" replace />}>
        <Route index element={<DashboardPage />} />
        <Route path="monet" element={<MonetPage />} />
        <Route path="breakdown" element={<BreakdownPage />} />
        <Route path="apps" element={<AppsPage />} />
        <Route path="accounts" element={<AccountsPage />} />
        <Route path="facebook" element={<FacebookPage />} />
        <Route path="google-ads" element={<GoogleAdsPage />} />
        <Route path="users" element={<AdminOnly><UsersPage /></AdminOnly>} />
        <Route path="sync-history" element={<AdminOnly><SyncHistoryPage /></AdminOnly>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function AdminOnly({ children }: { children: ReactElement }) {
  const { can } = useAuth();
  return can('ADMIN') ? children : <Navigate to="/" replace />;
}

function Layout() {
  const { user, logout, can } = useAuth();
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">AdMob CMS</div>
        <nav>
          <NavLink to="/" end>Tổng quan</NavLink>
          <NavLink to="/monet">Monet & UA</NavLink>
          <NavLink to="/breakdown">Phân tích chi tiết</NavLink>
          <NavLink to="/apps">Ứng dụng</NavLink>
          <NavLink to="/accounts">Tài khoản AdMob</NavLink>
          <NavLink to="/facebook">Facebook Ads</NavLink>
          <NavLink to="/google-ads">Google Ads</NavLink>
          {can('ADMIN') && <NavLink to="/users">Người dùng</NavLink>}
          {can('ADMIN') && <NavLink to="/sync-history">Lịch sử đồng bộ</NavLink>}
        </nav>
        <div className="sidebar-footer">
          <div className="user-name">{user!.name}</div>
          <div className="muted small">{user!.email} · {user!.role}</div>
          <button className="link" onClick={logout}>Đăng xuất</button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
