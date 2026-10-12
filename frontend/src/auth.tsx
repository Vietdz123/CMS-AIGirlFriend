import { useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { api, post, token } from './api';
import type { Me, Role } from './types';

interface AuthState {
  user: Me | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  can: (...roles: Role[]) => boolean;
}

const AuthContext = createContext<AuthState>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(!!token.get());
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!token.get()) return;
    api<Me>('/auth/me')
      .then(setUser)
      .catch(() => token.clear())
      .finally(() => setLoading(false));
  }, []);

  const value: AuthState = {
    user,
    loading,
    async login(email, password) {
      const res = await post<{ accessToken: string; user: Me }>('/auth/login', { email, password });
      token.set(res.accessToken);
      setUser(res.user);
    },
    logout() {
      token.clear();
      queryClient.clear();
      setUser(null);
    },
    can: (...roles) => !!user && roles.includes(user.role),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
