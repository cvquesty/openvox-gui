/**
 * OpenVox GUI - AuthContext.tsx
 *
 * Session via httpOnly cookie; all HTTP goes through services/api.ts (srdevarch1 MP3).
 */
import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { auth } from '../services/api';

interface User {
  username: string;
  role: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  login: async () => {},
  logout: () => {},
  loading: true,
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    auth
      .me()
      .then((data) => {
        setUser({ username: data.user_id || data.username, role: data.role });
      })
      .catch(async () => {
        try {
          const data = await auth.status();
          if (!data.auth_required) {
            setUser({ username: 'anonymous', role: 'admin' });
          }
        } catch {
          /* ignore */
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (username: string, password: string) => {
    const data = await auth.login(username, password);
    setUser(data.user);
    localStorage.removeItem('openvox_token');
  };

  const logout = () => {
    auth.logout().catch(() => {});
    setUser(null);
    setToken(null);
    localStorage.removeItem('openvox_token');
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}
