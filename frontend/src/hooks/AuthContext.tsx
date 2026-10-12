/**
 * OpenVox GUI - AuthContext.tsx
 *
 * Session via httpOnly cookie; all HTTP goes through services/api.ts.
 * Subscribes to sessionGate so VIP 401 storms soft-land on the login
 * screen once (no window.location.reload loop).
 */
import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { auth } from '../services/api';
import { loadAccessMode } from '../utils/accessMode';
import { browserReturnTo, rememberReturnTo } from '../utils/returnTo';
import { onSessionEvent, resetSessionGate } from '../utils/sessionGate';

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
    // VIP vs direct — softens polls when Host is a configured VIP.
    loadAccessMode().catch(() => {});

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

  // Soft session expiry (no full page reload). Keep the deep link so
  // the login mode can return there instead of the dashboard.
  useEffect(() => {
    return onSessionEvent((event) => {
      if (event === 'expired') {
        rememberReturnTo(browserReturnTo());
        setUser(null);
        setToken(null);
      }
    });
  }, []);

  const login = async (username: string, password: string) => {
    resetSessionGate();
    const data = await auth.login(username, password);
    setUser(data.user);
    localStorage.removeItem('openvox_token');
    // Refresh access mode after login (Host unchanged, but keeps state fresh).
    loadAccessMode().catch(() => {});
  };

  const logout = () => {
    auth.logout().catch(() => {});
    resetSessionGate();
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
