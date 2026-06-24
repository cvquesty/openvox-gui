/**
 * OpenVox GUI - AuthContext.tsx
 * 
 * Component documentation to be expanded.
 */
import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

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

  // On mount, rely on httpOnly cookie for auth (backend sets it on login).
  // No longer persist raw JWT to localStorage (XSS mitigation + prefer cookie).
  useEffect(() => {
    // Validate current session via cookie (no explicit token header)
    fetch('/api/auth/me')
      .then((res) => {
        if (res.ok) return res.json();
        throw new Error('No valid session');
      })
      .then((data) => {
        setUser({ username: data.user_id || data.username, role: data.role });
        // Do not set token state from client storage
      })
      .catch(() => {
        // Check if auth is even required
        fetch('/api/auth/status')
          .then((res) => res.json())
          .then((data) => {
            if (!data.auth_required) {
              setUser({ username: 'anonymous', role: 'admin' });
            }
          })
          .catch(() => {});
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (username: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Login failed' }));
      throw new Error(err.detail || 'Login failed');
    }
    const data = await res.json();
    // Server sets httpOnly cookie; do not store raw token in localStorage (security)
    // Token is no longer needed client-side for auth header.
    setUser(data.user);
    // Clear any legacy token
    localStorage.removeItem('openvox_token');
  };

  const logout = () => {
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
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
